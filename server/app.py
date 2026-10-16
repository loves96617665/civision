"""app.py — civision-gateway 主服务。

三套接口：
  /v1/*        OpenAI 兼容（images / videos / chat / models）
  /studio/api/* 创作工作台
  /admin/api/*  管理台（API KEY / 号池 / 模型开关 / 一键补号）
  /             WebUI 静态资源
"""
from __future__ import annotations

import asyncio
import json
import os
import secrets
import threading
import time
import traceback
from typing import Any, Optional

import httpx
from fastapi import Body, Depends, FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles

import civision
import config
import keystore
import mailbox as mailbox_mod
import pool
import provision
import registry
import store

WEBUI_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "webui")
STARTED_AT = time.time()


class UTF8JSONResponse(JSONResponse):
    """显式声明 charset=utf-8。

    FastAPI 默认只发 `application/json`，Windows PowerShell 5.1 的 Invoke-RestMethod
    在没有 charset 时会按 ISO-8859-1 解码，中文全部变乱码。带上 charset 后
    PS 5.1 / curl / 各种 HTTP 客户端都能正确解码。
    """
    media_type = "application/json; charset=utf-8"


app = FastAPI(title="civision-gateway", version=config.VERSION,
              docs_url="/docs", redoc_url=None, openapi_url="/openapi.json",
              default_response_class=UTF8JSONResponse)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
def _startup() -> None:
    store.init()
    added = registry.seed_db()
    store.log("info", "boot", f"civision-gateway {config.VERSION} 启动；模型注册表新增 {added} 条")
    k = keystore.ensure_default_key()
    banner = [
        "",
        "=" * 74,
        f"  civision-gateway {config.VERSION}",
        f"  上游        : {config.SETTINGS.upstream_base}",
        f"  WebUI       : http://{config.SETTINGS.host}:{config.SETTINGS.port}/",
        f"  管理台令牌  : {config.ADMIN_TOKEN}",
    ]
    if k:
        banner.append(f"  默认 API KEY: {k['key']}   （仅显示一次）")
    else:
        banner.append("  API KEY     : 在管理台创建，或调用 POST /admin/api/keys")
    banner.append(f"  模型         : {registry.models_view()['counts']}")
    banner.append("=" * 74)
    print("\n".join(banner), flush=True)


# ==================================================================== 错误
ERROR_TYPES = {
    "auth": ("invalid_api_key", 401),
    "quota": ("insufficient_quota", 402),
    "rate": ("rate_limit_exceeded", 429),
    "param": ("invalid_request_error", 400),
    "server": ("upstream_error", 502),
    "unknown": ("upstream_error", 502),
}


def err(message: str, type_: str = "invalid_request_error", status: int = 400,
        code: str = "", extra: dict | None = None) -> JSONResponse:
    body = {"error": {"message": message, "type": type_, "code": code or type_}}
    if extra:
        body["error"].update(extra)
    return UTF8JSONResponse(status_code=status, content=body)


def upstream_error(e: civision.UpstreamError) -> JSONResponse:
    t, s = ERROR_TYPES.get(e.kind, ("upstream_error", 502))
    if e.status == 429:
        t, s = "rate_limit_exceeded", 429
    elif e.status in (401, 403):
        t, s = "InvalidAuthentication", 401
    return err(str(e), t, s, e.code, {"upstream_status": e.status,
                                      "request_id": e.request_id, "channel": e.channel})


# ==================================================================== 鉴权
async def require_key(authorization: str = Header(default=""),
                      x_api_key: str = Header(default="")) -> dict:
    raw = ""
    if authorization.lower().startswith("bearer "):
        raw = authorization[7:].strip()
    elif x_api_key:
        raw = x_api_key.strip()
    if not raw:
        raise HTTPException(status_code=401, detail="缺少 API KEY（Authorization: Bearer sk-civ-...）")
    k = keystore.find_by_secret(raw)
    if not k:
        raise HTTPException(status_code=401, detail="API KEY 无效")
    if not k["enabled"]:
        raise HTTPException(status_code=401, detail="API KEY 已禁用")
    if k["quota"] and k["used"] >= k["quota"]:
        raise HTTPException(status_code=402, detail="该 KEY 配额已用尽")
    if k["rpm"]:
        today = keystore.usage_today(k["id"])
        if today > k["rpm"] * 1440:
            raise HTTPException(status_code=429, detail="该 KEY 触发速率限制")
    keystore.touch(k["id"])
    return k


async def require_admin(x_admin_token: str = Header(default="")) -> bool:
    if not x_admin_token or not secrets.compare_digest(x_admin_token, config.ADMIN_TOKEN):
        raise HTTPException(status_code=401, detail="管理令牌无效（X-Admin-Token）")
    return True


# ==================================================================== 任务执行
def _task_view(row: Any) -> dict:
    status = row["status"]
    outputs = store.jload(row["outputs"], [])
    progress = {"queued": 8, "running": 60, "succeeded": 100, "failed": 100}.get(status, 12)
    return {
        "task_id": row["id"], "id": row["id"], "kind": row["kind"], "status": status,
        "model": row["model"], "prompt": row["prompt"],
        "params": store.jload(row["params"], {}),
        "outputs": outputs,
        "error": row["error"], "account": row["account_label"],
        "created": row["created"], "started": row["started"], "finished": row["finished"],
        "starred": bool(row["starred"]), "star": bool(row["starred"]),
        "progress": progress,
        "elapsed": round((row["finished"] or time.time()) - row["created"], 2),
    }


def _new_task(kind: str, model: str, prompt: str, params: dict, key_id: str = "") -> str:
    tid = "tsk_" + secrets.token_hex(8)
    store.execute(
        "INSERT INTO tasks (id,kind,status,model,prompt,params,outputs,error,account_id,"
        "account_label,upstream,key_id,starred,created,started,finished) "
        "VALUES (?,?,?,?,?,?,'[]','','','','{}',?,0,?,0,0)",
        (tid, kind, "queued", model, prompt, store.jdump(params), key_id, time.time()))
    return tid


def _finish(tid: str, status: str, outputs: list[dict] | None = None, error: str = "",
            account_id: str = "", account_label: str = "", upstream: Any = None) -> None:
    store.execute(
        "UPDATE tasks SET status=?,outputs=?,error=?,account_id=?,account_label=?,upstream=?,"
        "finished=? WHERE id=?",
        (status, store.jdump(outputs or []), (error or "")[:2000], account_id, account_label,
         store.jdump(upstream if isinstance(upstream, (dict, list)) else {}), time.time(), tid))


def _run_task(tid: str, kind: str, entry: dict, payload: dict, timeout: float) -> None:
    """后台线程执行一次生成。"""
    store.execute("UPDATE tasks SET status='running',started=? WHERE id=?", (time.time(), tid))

    def factory(_acc: pool.Account) -> dict:
        if kind == "image":
            dp = registry.default_params_for(entry)
            extra_basic = {}
            if payload.get("steps") is not None:
                extra_basic["num_inference_steps"] = int(payload["steps"])
            if payload.get("guidance_scale") is not None:
                extra_basic["guidance_scale"] = float(payload["guidance_scale"])
            if payload.get("sampler"):
                extra_basic["sampler"] = payload["sampler"]
            if payload.get("seed") is not None:
                extra_basic["seed"] = int(payload["seed"])
            lora = payload.get("lora") or None
            if lora:
                lora = [{"model_version_id": int(x["model_version_id"]),
                         **({"weight": float(x["weight"])} if x.get("weight") is not None else {})}
                        for x in lora]
            return civision.CivisionClient.build_image_body(
                model=entry["model"], prompt=payload.get("prompt", ""),
                width=int(payload.get("width") or dp.get("width") or 1024),
                height=int(payload.get("height") or dp.get("height") or 1024),
                quantity=int(payload.get("quantity") or payload.get("n") or 1),
                negative_prompt=payload.get("negative_prompt") or "",
                lora=lora, image=payload.get("image") or "",
                strength=float(payload.get("strength") or 1.0),
                mode=payload.get("mode") or "custom",
                extra_basic=extra_basic)
        # video
        if kind == "video":
            refs = payload.get("references") or None
            basic = dict(registry.default_params_for(entry).get("raw_basic") or {})
            if payload.get("steps") is not None:
                basic["numInferenceSteps"] = int(payload["steps"])
            if payload.get("guidance_scale") is not None:
                basic["guidanceScale"] = float(payload["guidance_scale"])
            if payload.get("seed") is not None:
                basic["seed"] = int(payload["seed"])
            return civision.CivisionClient.build_video_body(
                version_id=int(entry["version_id"]), prompt=payload.get("prompt", ""),
                width=int(payload.get("width") or basic.get("width") or 480),
                height=int(payload.get("height") or basic.get("height") or 848),
                total_seconds=float(payload.get("total_seconds") or 5),
                lora=payload.get("lora") or None, image=payload.get("image") or "",
                references=refs, basic=basic, mode=payload.get("mode") or "custom")

        # audio（音乐）—— 结构同构推断，见 civision.build_audio_body 注释
        basic = dict(registry.default_params_for(entry).get("raw_basic") or {})
        for src, dst in (("steps", "numInferenceSteps"), ("guidance_scale", "cfgScale"),
                         ("seed", "seed"), ("bpm", "bpm"), ("duration", "duration"),
                         ("audio_count", "audioCount"), ("sample_rate", "sampleRate"),
                         ("key_scale", "keyScale"), ("time_signature", "timeSignature"),
                         ("vocal_language", "vocalLanguage")):
            if payload.get(src) is not None:
                basic[dst] = payload[src]
        return civision.CivisionClient.build_audio_body(
            prompt=payload.get("prompt", ""), basic=basic,
            lyrics=payload.get("lyrics") or "", mode=payload.get("mode") or "custom")

    try:
        res = pool.POOL.generate(kind, factory, model=entry["alias"], timeout=timeout)
        status = res.get("status") or "failed"
        if status == "succeeded":
            _finish(tid, "succeeded", res.get("outputs") or [], account_id=res.get("account_id", ""),
                    account_label=res.get("account", ""), upstream=res.get("upstream"))
            store.log("info", "task", f"{tid} 成功（{kind}/{entry['alias']}）",
                      outputs=len(res.get("outputs") or []))
        elif status == "timeout":
            _finish(tid, "failed", [], res.get("error") or "生成超时",
                    account_id=res.get("account_id", ""), account_label=res.get("account", ""))
        else:
            _finish(tid, "failed", [], res.get("error") or "上游失败",
                    account_id=res.get("account_id", ""), account_label=res.get("account", ""))
    except civision.UpstreamError as e:
        _finish(tid, "failed", [], str(e))
        store.log("error", "task", f"{tid} 上游错误: {e}", kind=e.kind)
    except pool.PoolExhausted as e:
        _finish(tid, "failed", [], str(e))
        store.log("error", "task", f"{tid} 号池耗尽: {e}")
    except Exception as e:
        _finish(tid, "failed", [], f"{type(e).__name__}: {e}")
        store.log("error", "task", f"{tid} 异常: {e}", tb=traceback.format_exc()[-1500:])


def spawn_task(kind: str, entry: dict, payload: dict, *, timeout: float | None = None,
               key_id: str = "") -> str:
    tid = _new_task(kind, entry["alias"], payload.get("prompt", ""), payload, key_id)
    th = threading.Thread(target=_run_task, name=f"task-{tid}",
                          args=(tid, kind, entry, payload, timeout or config.SETTINGS.timeout),
                          daemon=True)
    th.start()
    return tid


def _wait_task(tid: str, timeout: float) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        row = store.q1("SELECT * FROM tasks WHERE id=?", (tid,))
        if row and row["status"] in ("succeeded", "failed"):
            return _task_view(row)
        time.sleep(0.5)
    row = store.q1("SELECT * FROM tasks WHERE id=?", (tid,))
    v = _task_view(row) if row else {"task_id": tid, "status": "failed", "error": "任务不存在"}
    if v["status"] not in ("succeeded", "failed"):
        v["status"] = "timeout"
    return v


# ==================================================================== OpenAI 面
@app.get("/v1/models")
async def v1_models(key: dict = Depends(require_key)) -> dict:
    data = [m for m in registry.public_models() if keystore.model_allowed(key, m["id"])]
    return {"object": "list", "data": data}


def _resolve_or_404(name: str) -> dict:
    e = registry.resolve(name)
    if not e:
        raise HTTPException(status_code=404, detail=f"模型不存在: {name}")
    row = store.q1("SELECT enabled FROM models WHERE alias=?", (e["alias"],))
    if row is not None and not row["enabled"]:
        raise HTTPException(status_code=404, detail=f"模型已停用: {name}")
    return e


@app.post("/v1/images/generations")
async def v1_images(payload: dict = Body(...), key: dict = Depends(require_key)):
    model_name = str(payload.get("model") or "")
    if not model_name:
        d = registry.default_for("image")
        model_name = d["alias"] if d else ""
    entry = _resolve_or_404(model_name)
    if entry["kind"] != "image":
        return err(f"{model_name} 不是图片模型（kind={entry['kind']}）", "invalid_request_error", 400)
    if not keystore.model_allowed(key, entry["alias"]):
        return err(f"当前 API KEY 无权使用 {entry['alias']}", "invalid_request_error", 403)

    if not payload.get("prompt") and not payload.get("image"):
        return err("prompt 不能为空", "invalid_request_error", 400)

    size = str(payload.get("size") or "")
    if size and "x" in size:
        try:
            w, h = size.lower().split("x")
            payload["width"], payload["height"] = int(w), int(h)
        except Exception:
            pass
    payload.setdefault("quantity", payload.get("n", 1))

    tid = spawn_task("image", entry, payload, timeout=float(payload.get("timeout") or 0) or None,
                     key_id=key["id"])
    if payload.get("async_mode") or payload.get("background"):
        return {"id": tid, "object": "image.generation", "status": "queued"}

    v = _wait_task(tid, float(payload.get("timeout") or config.SETTINGS.timeout) + 15)
    if v["status"] != "succeeded":
        t = "upstream_timeout" if v["status"] == "timeout" else "upstream_error"
        s = 504 if v["status"] == "timeout" else 502
        return err(v.get("error") or "生成失败", t, s, extra={"task_id": tid})

    fmt = payload.get("response_format") or "url"
    data = []
    for o in v["outputs"]:
        item: dict[str, Any] = {"revised_prompt": payload.get("prompt", "")}
        if fmt == "b64_json":
            try:
                r = httpx.get(o["url"], timeout=60)
                import base64
                item["b64_json"] = base64.b64encode(r.content).decode()
            except Exception as e:
                item["url"] = o["url"]
                item["b64_error"] = str(e)[:200]
        else:
            item["url"] = o["url"]
        if o.get("width"):
            item["width"], item["height"] = o.get("width"), o.get("height")
        data.append(item)
    return {"created": int(time.time()), "data": data, "task_id": tid,
            "account": v.get("account", "")}


@app.post("/v1/videos/generations")
async def v1_videos(payload: dict = Body(...), key: dict = Depends(require_key)):
    model_name = str(payload.get("model") or "")
    if not model_name:
        d = registry.default_for("video")
        model_name = d["alias"] if d else ""
    entry = _resolve_or_404(model_name)
    if entry["kind"] != "video":
        return err(f"{model_name} 不是视频模型（kind={entry['kind']}）", "invalid_request_error", 400)
    if not keystore.model_allowed(key, entry["alias"]):
        return err(f"当前 API KEY 无权使用 {entry['alias']}", "invalid_request_error", 403)
    if not payload.get("prompt") and not payload.get("image"):
        return err("prompt 不能为空", "invalid_request_error", 400)

    size = str(payload.get("size") or "")
    if size and "x" in size:
        try:
            w, h = size.lower().split("x")
            payload["width"], payload["height"] = int(w), int(h)
        except Exception:
            pass
    if payload.get("seconds") is not None:
        payload["total_seconds"] = payload["seconds"]

    tid = spawn_task("video", entry, payload, timeout=float(payload.get("timeout") or 0) or None,
                     key_id=key["id"])
    v = _wait_task(tid, float(payload.get("timeout") or config.SETTINGS.timeout) + 15)
    return {
        "id": tid, "object": "video", "created": int(time.time()),
        "model": entry["alias"], "status": v["status"],
        "data": [{"url": o["url"]} for o in v.get("outputs", [])],
        "error": v.get("error") or None,
    }


@app.get("/v1/videos/{vid}")
async def v1_video_get(vid: str, key: dict = Depends(require_key)):
    row = store.q1("SELECT * FROM tasks WHERE id=?", (vid,))
    if not row:
        return err("任务不存在", "invalid_request_error", 404)
    v = _task_view(row)
    return {"id": v["task_id"], "object": "video", "status": v["status"],
            "model": v["model"], "created": int(v["created"]),
            "data": [{"url": o["url"]} for o in v["outputs"]], "error": v["error"] or None}


@app.get("/v1/tasks/{tid}")
async def v1_task_get(tid: str, key: dict = Depends(require_key)):
    row = store.q1("SELECT * FROM tasks WHERE id=?", (tid,))
    if not row:
        return err("任务不存在", "invalid_request_error", 404)
    return _task_view(row)


@app.post("/v1/chat/completions")
async def v1_chat(payload: dict = Body(...), key: dict = Depends(require_key)):
    """多模态入口：文本 + 参考图 -> 图片/视频。"""
    model_name = str(payload.get("model") or "")
    entry = _resolve_or_404(model_name) if model_name else None
    messages = payload.get("messages") or []
    text, images = "", []
    for m in messages:
        c = m.get("content")
        if isinstance(c, str):
            text += ("\n" if text else "") + c
        elif isinstance(c, list):
            for part in c:
                if part.get("type") == "text":
                    text += ("\n" if text else "") + str(part.get("text", ""))
                elif part.get("type") in ("image_url", "input_image"):
                    u = part.get("image_url") or part.get("image_url", {})
                    url = u.get("url") if isinstance(u, dict) else str(u)
                    if url:
                        images.append(url)
    if entry is None:
        entry = registry.default_for("video" if "video" in (payload.get("modalities") or []) else "image")
    kind = entry["kind"] if entry["kind"] in ("image", "video") else "image"
    body = {"prompt": text.strip(), "quantity": 1}
    if images:
        body["image"] = images[0]
        body["references"] = [{"type": "IMAGE", "image": u} for u in images]
    tid = spawn_task(kind, entry, body, key_id=key["id"])
    v = _wait_task(tid, config.SETTINGS.timeout + 15)
    if v["status"] != "succeeded":
        return err(v.get("error") or "生成失败", "upstream_error", 502, extra={"task_id": tid})
    content = [{"type": "text", "text": f"已生成 {len(v['outputs'])} 个结果。"}]
    for o in v["outputs"]:
        content.append({"type": "image_url", "image_url": {"url": o["url"]}}
                       if o["type"] == "image" else {"type": "video_url", "video_url": {"url": o["url"]}})
    return {
        "id": "chatcmpl-" + tid, "object": "chat.completion", "created": int(time.time()),
        "model": entry["alias"],
        "choices": [{"index": 0, "finish_reason": "stop",
                     "message": {"role": "assistant", "content": content}}],
        "task_id": tid,
    }


# ==================================================================== Studio 面
@app.get("/studio/api/catalog")
async def studio_catalog(key: dict = Depends(require_key)):
    cat = registry.full_catalog()
    tags = []
    try:
        c = civision.CivisionClient(civision.ClientOptions(timeout=30))
        r = c.request("GET", "/v1/models/aigc/tags")
        tags = ((r or {}).get("Data") or {}).get("data") or []
        c.close()
    except Exception:
        pass
    for kind in ("image", "video", "audio"):
        cat[kind] = [m for m in cat[kind] if keystore.model_allowed(key, m["alias"])]
    cat["style_tags"] = tags
    return cat


@app.post("/studio/api/generate")
async def studio_generate(payload: dict = Body(...), key: dict = Depends(require_key)):
    kind = str(payload.get("kind") or "image")
    name = str(payload.get("model") or "")
    entry = registry.resolve(name) if name else registry.default_for(kind)
    if not entry:
        return err(f"模型不存在: {name}", "invalid_request_error", 404)
    if not keystore.model_allowed(key, entry["alias"]):
        return err(f"当前 API KEY 无权使用 {entry['alias']}", "invalid_request_error", 403)
    if not payload.get("prompt") and not payload.get("image"):
        return err("prompt 不能为空", "invalid_request_error", 400)
    tid = spawn_task(entry["kind"], entry, payload, key_id=key["id"])
    return {"task_id": tid, "status": "queued", "model": entry["alias"], "kind": entry["kind"]}


@app.get("/studio/api/tasks/{tid}")
async def studio_task(tid: str, key: dict = Depends(require_key)):
    row = store.q1("SELECT * FROM tasks WHERE id=?", (tid,))
    if not row:
        return err("任务不存在", "invalid_request_error", 404)
    return _task_view(row)


@app.get("/studio/api/gallery")
async def studio_gallery(limit: int = 60, kind: str = "", star: int = 0,
                         key: dict = Depends(require_key)):
    sql = "SELECT * FROM tasks WHERE status='succeeded'"
    args: list[Any] = []
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    if star:
        sql += " AND starred=1"
    sql += " ORDER BY created DESC LIMIT ?"
    args.append(max(1, min(300, limit)))
    return {"items": [_task_view(r) for r in store.q(sql, args)]}


@app.post("/studio/api/tasks/{tid}/star")
async def studio_star(tid: str, payload: dict = Body(default={}), key: dict = Depends(require_key)):
    v = 1 if payload.get("starred", True) else 0
    store.execute("UPDATE tasks SET starred=? WHERE id=?", (v, tid))
    return {"task_id": tid, "starred": bool(v)}


@app.post("/studio/api/uploads")
async def studio_upload(request: Request, key: dict = Depends(require_key)):
    """参考图 / 参考视频上传。

    三段式上游协议：POST /v1/rm/uploadUrl → PUT <UploadUrl> → POST /v1/rm/downloadUrl。
    支持两种入参：
      * multipart/form-data  字段名 file，可选 kind=image|video、type=<OSS Type>
      * application/json     {"filename": "...", "data_url": "data:image/png;base64,..."}
    号池无可用账号时降级为本地落盘（server/data/uploads/），返回 local_url 供本地预览。
    """
    import base64
    import mimetypes
    import re as _re

    ctype = request.headers.get("content-type", "")
    filename, blob, mime = "upload.bin", b"", ""
    oss_type = "AIGC_MUSE_IMG"

    if ctype.startswith("multipart/form-data"):
        form = await request.form()
        up = form.get("file")
        if up is None:
            return err("缺少 file 字段", "invalid_request_error", 400)
        filename = getattr(up, "filename", None) or "upload.bin"
        blob = await up.read()
        mime = getattr(up, "content_type", "") or mimetypes.guess_type(filename)[0] or ""
        oss_type = str(form.get("type") or oss_type)
        if str(form.get("kind") or "") == "video":
            oss_type = "AIGC_COVER_VIDEO"
    else:
        body = await request.json()
        filename = str(body.get("filename") or "upload.bin")
        data_url = str(body.get("data_url") or "")
        m = _re.match(r"^data:([^;]+);base64,(.*)$", data_url, _re.S)
        if not m:
            return err("data_url 格式应为 data:<mime>;base64,<payload>", "invalid_request_error", 400)
        mime = m.group(1)
        try:
            blob = base64.b64decode(m.group(2))
        except Exception as e:
            return err(f"base64 解码失败: {e}", "invalid_request_error", 400)
        oss_type = str(body.get("type") or oss_type)

    if not blob:
        return err("文件内容为空", "invalid_request_error", 400)
    if len(blob) > 32 * 1024 * 1024:
        return err("文件超过 32MB 上限", "invalid_request_error", 400)

    # 先本地留档（也作为降级路径）
    local_dir = os.path.join(config.DATA_DIR, "uploads")
    os.makedirs(local_dir, exist_ok=True)
    local_name = f"{secrets.token_hex(8)}_{os.path.basename(filename)[:80]}"
    local_path = os.path.join(local_dir, local_name)
    with open(local_path, "wb") as fh:
        fh.write(blob)
    local_url = f"/studio/uploads/{local_name}"

    out: dict[str, Any] = {
        "filename": filename, "size": len(blob), "content_type": mime,
        "oss_type": oss_type, "local_url": local_url,
        "url": local_url, "upstream": False,
    }

    acc = pool.POOL.acquire("image")
    if acc is None:
        out["note"] = "号池无可用账号，仅本地落盘；上游生成需要可被上游访问的 URL"
        return out
    try:
        res = acc.client().upload_bytes(filename, blob,
                                        mime or "application/octet-stream", oss_type)
        out.update({"url": res.get("download_url") or res.get("file_url"),
                    "file_url": res.get("file_url"), "upstream": True})
        try:
            reg = acc.client().register_media([{
                "height": 0, "index": 0, "sourceType": "MUSE_UPLOAD",
                "url": res.get("file_url"), "width": 0,
                "mediaType": "video" if "VIDEO" in oss_type else "image",
            }])
            items = ((reg or {}).get("data") or [])
            if items and isinstance(items, list) and items[0].get("id"):
                out["media_id"] = items[0]["id"]
                out["url"] = items[0].get("url") or out["url"]
        except civision.UpstreamError as e:
            out["register_error"] = str(e)[:200]
        pool.POOL.report(acc, ok=True)
        return out
    except civision.UpstreamError as e:
        pool.POOL.report(acc, ok=False, error=str(e), kind_hint=e.kind)
        out["note"] = f"上游上传失败，已本地落盘：{e}"
        return out


@app.get("/studio/uploads/{name}")
async def studio_upload_file(name: str):
    p = os.path.join(config.DATA_DIR, "uploads", os.path.basename(name))
    if not os.path.isfile(p):
        raise HTTPException(404, "not found")
    return FileResponse(p)


@app.post("/studio/api/agent/generate")
async def studio_agent(payload: dict = Body(...), key: dict = Depends(require_key)):
    """Agent 模式：创建会话 + SSE 流式生成，落成普通任务供轮询。

    上游：POST /api/v1/aigc/agentic/conversations
          POST /api/v1/aigc/agentic/conversations/{uuid}/generate  (text/event-stream)
    """
    entry = registry.resolve(str(payload.get("model") or "")) or registry.default_for("image")
    if not entry:
        return err("模型不存在", "invalid_request_error", 404)
    if not payload.get("prompt"):
        return err("prompt 不能为空", "invalid_request_error", 400)

    tid = _new_task("image", entry["alias"], payload.get("prompt", ""), payload, key["id"])

    def worker() -> None:
        store.execute("UPDATE tasks SET status='running',started=? WHERE id=?",
                      (time.time(), tid))
        acc = pool.POOL.acquire("image", entry["alias"])
        if acc is None:
            _finish(tid, "failed", [], "号池无可用账号（请先添加账号或执行一键补号）")
            return
        try:
            conv = acc.client().create_conversation(title=(payload.get("prompt") or "")[:40])
            uuid_ = ((conv or {}).get("data") or {}).get("uuid") or \
                    ((conv or {}).get("data") or {}).get("conversation_uuid") or \
                    str((conv or {}).get("uuid") or "")
            if not uuid_:
                _finish(tid, "failed", [], f"创建会话失败: {str(conv)[:200]}")
                return
            outputs: list[dict] = []
            err_msg = ""
            images = payload.get("references") or []
            ratio = {"width": payload.get("width"), "height": payload.get("height")}
            for ev in acc.client().agent_stream(uuid_, prompt=payload["prompt"],
                                                 images=images, image_ratio=ratio):
                typ = str(ev.get("type") or ev.get("event") or "")
                if typ == "error":
                    err_msg = str(ev.get("message") or ev.get("content") or "")[:300]
                    break
                if typ in ("aigc_agentic_result", "image_generation_result",
                           "image_generation_started", "aigc_image_generation_result"):
                    outputs.extend(civision.extract_outputs(ev, "image"))
                if outputs:
                    break
            pool.POOL.report(acc, model=entry["alias"], ok=not err_msg,
                             error=err_msg)
            if outputs:
                _finish(tid, "succeeded", outputs, account_id=acc.id,
                        account_label=acc.label, upstream={"conversation": uuid_})
            else:
                _finish(tid, "failed", [], err_msg or "SSE 未返回产物",
                        account_id=acc.id, account_label=acc.label)
        except civision.UpstreamError as e:
            pool.POOL.report(acc, model=entry["alias"], ok=False, error=str(e), kind_hint=e.kind)
            _finish(tid, "failed", [], str(e), account_id=acc.id, account_label=acc.label)
        except Exception as e:
            _finish(tid, "failed", [], f"{type(e).__name__}: {e}")
            store.log("error", "task", f"{tid} agent 异常: {e}",
                      tb=traceback.format_exc()[-1200:])

    threading.Thread(target=worker, name=f"agent-{tid}", daemon=True).start()
    return {"task_id": tid, "status": "queued", "mode": "agent", "model": entry["alias"]}


@app.get("/studio/api/gallery/{tid}/star")
async def studio_star_alias_get(tid: str, key: dict = Depends(require_key)):
    row = store.q1("SELECT starred FROM tasks WHERE id=?", (tid,))
    if not row:
        return err("任务不存在", "invalid_request_error", 404)
    return {"task_id": tid, "starred": bool(row["starred"])}


@app.post("/studio/api/gallery/{tid}/star")
async def studio_star_alias(tid: str, payload: dict = Body(default={}),
                            key: dict = Depends(require_key)):
    v = 1 if payload.get("starred", True) else 0
    store.execute("UPDATE tasks SET starred=? WHERE id=?", (v, tid))
    return {"task_id": tid, "starred": bool(v)}


@app.get("/studio/api/health")
async def studio_health(key: dict = Depends(require_key)):
    up = civision.probe_reachable()
    return {"upstream": up, "pool": pool.POOL.count(),
            "models": registry.models_view()["counts"], "version": config.VERSION}


# ==================================================================== Admin 面
@app.get("/admin/api/overview")
async def admin_overview(_: bool = Depends(require_admin)):
    poolc = pool.POOL.count()
    mc = registry.models_view()["counts"]
    keys = keystore.list_keys()
    total = store.q1("SELECT COUNT(*) AS n FROM tasks")
    today0 = time.time() - 86400
    today = store.q1("SELECT COUNT(*) AS n FROM tasks WHERE created>?", (today0,))
    failed = store.q1("SELECT COUNT(*) AS n FROM tasks WHERE status='failed'")
    return {
        "version": config.VERSION, "uptime": int(time.time() - STARTED_AT),
        "keys": {"total": len(keys), "enabled": sum(1 for k in keys if k["enabled"])},
        "pool": poolc,
        "models": mc,
        "requests": {"total": total["n"] if total else 0, "today": today["n"] if today else 0,
                     "failed": failed["n"] if failed else 0},
        "upstream": civision.probe_reachable(),
    }


@app.get("/admin/api/keys")
async def admin_keys(_: bool = Depends(require_admin)):
    return {"items": keystore.list_keys()}


@app.post("/admin/api/keys")
async def admin_key_create(payload: dict = Body(...), _: bool = Depends(require_admin)):
    return keystore.create_key(str(payload.get("name") or "key"),
                               note=payload.get("note") or "",
                               models=payload.get("models") or ["*"],
                               rpm=int(payload.get("rpm") or 0),
                               quota=int(payload.get("quota") or 0))


@app.get("/admin/api/keys/{kid}")
async def admin_key_get(kid: str, _: bool = Depends(require_admin)):
    k = keystore.get_key(kid)
    if not k:
        raise HTTPException(404, "KEY 不存在")
    return k


@app.patch("/admin/api/keys/{kid}")
async def admin_key_patch(kid: str, payload: dict = Body(...), _: bool = Depends(require_admin)):
    k = keystore.patch_key(kid, payload)
    if not k:
        raise HTTPException(404, "KEY 不存在")
    return k


@app.delete("/admin/api/keys/{kid}")
async def admin_key_delete(kid: str, _: bool = Depends(require_admin)):
    return {"ok": keystore.delete_key(kid)}


@app.post("/admin/api/keys/{kid}/reset")
async def admin_key_reset(kid: str, _: bool = Depends(require_admin)):
    k = keystore.reset_usage(kid)
    if not k:
        raise HTTPException(404, "KEY 不存在")
    return k


@app.get("/admin/api/accounts")
async def admin_accounts(_: bool = Depends(require_admin)):
    return {"items": [a.view() for a in pool.POOL.all()], "count": pool.POOL.count()}


@app.post("/admin/api/accounts")
async def admin_account_add(payload: dict = Body(...), _: bool = Depends(require_admin)):
    try:
        return pool.POOL.add_account(cookie=payload.get("cookie") or "",
                                     token=payload.get("token") or "",
                                     label=payload.get("label") or "",
                                     email=payload.get("email") or "",
                                     password=payload.get("password") or "",
                                     source="manual")
    except ValueError as e:
        raise HTTPException(400, str(e))


@app.post("/admin/api/accounts/import")
async def admin_account_import(payload: dict = Body(...), _: bool = Depends(require_admin)):
    items = pool.POOL.import_many(payload.get("text") or "",
                                  payload.get("label") or "批量导入")
    return {"items": items, "imported": len(items), "count": len(items)}


@app.patch("/admin/api/accounts/{aid}")
async def admin_account_patch(aid: str, payload: dict = Body(...), _: bool = Depends(require_admin)):
    v = pool.POOL.patch(aid, payload)
    if not v:
        raise HTTPException(404, "账号不存在")
    return v


@app.post("/admin/api/accounts/{aid}/enable")
async def admin_account_enable(aid: str, payload: dict = Body(default={}),
                               _: bool = Depends(require_admin)):
    v = pool.POOL.set_enabled(aid, bool(payload.get("enabled", True)))
    if not v:
        raise HTTPException(404, "账号不存在")
    return v


@app.post("/admin/api/accounts/{aid}/check")
async def admin_account_check(aid: str, _: bool = Depends(require_admin)):
    try:
        return pool.POOL.check(aid)
    except KeyError:
        raise HTTPException(404, "账号不存在")


@app.post("/admin/api/accounts/check-all")
async def admin_account_check_all(_: bool = Depends(require_admin)):
    return {"items": pool.POOL.check_all()}


@app.delete("/admin/api/accounts/{aid}")
async def admin_account_delete(aid: str, _: bool = Depends(require_admin)):
    return {"ok": pool.POOL.remove(aid)}


@app.get("/admin/api/mail/providers")
async def admin_mail_providers(_: bool = Depends(require_admin)):
    return {"items": mailbox_mod.provider_info(), "current": config.SETTINGS.mail_provider}


# ==================================================================== 浏览器托管
# 目的：干掉「DevTools 里抠 captcha_verify」这一步。
#   * 托管窗口里只要发生过注册，网关就自动嗅出 captcha_verify 并回填给等待中的补号任务
#   * 用户在托管窗口里正常登录/注册后，一键抓取 Cookie（含 HttpOnly）入池
BROWSER_SESSIONS: dict[str, dict] = {}


@app.get("/admin/api/browser/status")
async def admin_browser_status(_: bool = Depends(require_admin)):
    import browser
    st = browser.BROWSER.status()
    cap = browser.BROWSER.latest_captcha()
    return {**st, "captcha": {k: v for k, v in cap.items() if k != "token"},
            "captcha_tail": (cap.get("token") or "")[-8:]}


@app.post("/admin/api/browser/launch")
async def admin_browser_launch(payload: dict = Body(default={}),
                               _: bool = Depends(require_admin)):
    import browser
    url = str(payload.get("url") or browser.LOGIN_URL)
    headless = bool(payload.get("headless", False))
    try:
        return browser.BROWSER.launch(url, headless)
    except Exception as e:
        return err(f"启动浏览器失败: {e}", "upstream_error", 502)


@app.post("/admin/api/browser/goto")
async def admin_browser_goto(payload: dict = Body(...), _: bool = Depends(require_admin)):
    import browser
    try:
        return browser.BROWSER.goto(str(payload.get("url") or browser.LOGIN_URL))
    except Exception as e:
        return err(f"导航失败: {e}", "upstream_error", 502)


@app.post("/admin/api/browser/close")
async def admin_browser_close(_: bool = Depends(require_admin)):
    import browser
    return browser.BROWSER.close()


@app.post("/admin/api/browser/register")
async def admin_browser_register(payload: dict = Body(default={}),
                                 _: bool = Depends(require_admin)):
    """一站式「浏览器托管注册」。

    1. 先建一个临时邮箱（地址直接回给前端展示）
    2. 打开托管浏览器到注册页，尽力自动填好邮箱/用户名/密码
    3. 用户只需点「注册」+ 拖一次滑块
    4. 网关嗅到 captcha_verify 后自动回填给等待中的补号任务；
       用户完成注册后点「抓取会话入库」即可
    """
    import browser
    import mailbox as mb
    import provision

    provider = mb.normalize_name(str(payload.get("provider") or "")) or config.SETTINGS.mail_provider
    sid = "bsr_" + secrets.token_hex(5)
    rec: dict[str, Any] = {"id": sid, "provider": provider, "created": time.time(),
                           "stage": "mailbox", "error": ""}

    try:
        prov = mb.get_provider(provider)
        box = prov.create()
        rec["mailbox"] = box.to_dict()
        rec["email"] = box.address
    except Exception as e:
        rec["error"] = f"建邮箱失败: {e}"
        rec["stage"] = "failed"
        BROWSER_SESSIONS[sid] = rec
        return rec

    rec["username"] = provision.gen_username()
    rec["password"] = provision.gen_password()

    try:
        browser.BROWSER.launch(browser.REGISTER_URL)
        rec["prefill"] = browser.BROWSER.prefill(rec["email"], rec["username"], rec["password"])
        rec["stage"] = "browser_open"
    except Exception as e:
        rec["error"] = f"打开浏览器失败: {e}"
        rec["stage"] = "browser_failed"

    BROWSER_SESSIONS[sid] = rec
    store.log("info", "browser", f"托管注册会话 {sid} 邮箱={rec['email']}")
    return rec


@app.get("/admin/api/browser/register/{sid}")
async def admin_browser_register_status(sid: str, _: bool = Depends(require_admin)):
    """轮询托管注册会话：邮箱收到的信 / 嗅到的验证码 / 浏览器登录态。"""
    import browser
    import mailbox as mb

    rec = BROWSER_SESSIONS.get(sid)
    if not rec:
        raise HTTPException(404, "会话不存在")

    out = dict(rec)
    box_d = rec.get("mailbox") or {}
    if box_d.get("address"):
        try:
            prov = mb.get_provider(rec["provider"])
            addr = mb.Address(address=box_d["address"], provider=rec["provider"],
                              box_id=box_d.get("box_id", ""), meta=box_d.get("meta") or {})
            msgs = prov.messages(addr)
            out["messages"] = [{"id": str(m.get("id") or m.get("messageID") or ""),
                                "from": m.get("from") or m.get("fromAddress") or "",
                                "subject": m.get("subject") or "",
                                "date": m.get("date") or m.get("createdAt") or ""} for m in msgs]
            out["message_count"] = len(msgs)
            if msgs and not rec.get("activation_link"):
                full = None
                try:
                    full = prov.wait_for_activation(addr, timeout=1.0)
                except Exception:
                    full = None
                if full and full.get("confirm_link"):
                    rec["activation_link"] = full["confirm_link"]
                    out["activation_link"] = full["confirm_link"]
                    out["activation_subject"] = full.get("subject", "")
        except Exception as e:
            out["mailbox_error"] = str(e)[:200]

    cap = browser.BROWSER.latest_captcha()
    if cap:
        out["captcha_seen"] = {"length": cap.get("length"), "at": cap.get("at"),
                               "from": (cap.get("url") or "").rsplit("/", 1)[-1]}
    try:
        ck = browser.BROWSER.cookies()
        out["browser_cookies"] = ck.get("count", 0)
        out["logged_in_hint"] = any(n in ("m_session_id", "sid", "csrf_token")
                                    for n in ck.get("names", []))
    except Exception:
        out["browser_cookies"] = 0
    return out


@app.post("/admin/api/accounts/from-browser")
async def admin_account_from_browser(payload: dict = Body(default={}),
                                     _: bool = Depends(require_admin)):
    """从托管浏览器抓 Cookie（含 HttpOnly）直接入号池。零 DevTools、零复制粘贴。"""
    import browser
    try:
        ck = browser.BROWSER.cookies(str(payload.get("domain") or "modelscope"))
    except Exception as e:
        return err(f"读取浏览器 Cookie 失败: {e}", "upstream_error", 502)

    if not ck.get("header"):
        return err("托管浏览器里没有 modelscope 的 Cookie —— 请先在窗口里登录/注册成功",
                   "invalid_request_error", 400)

    acc = pool.POOL.add_account(cookie=ck["header"],
                                label=str(payload.get("label") or "") or f"浏览器导入 {time.strftime('%m-%d %H:%M')}",
                                email=str(payload.get("email") or ""), source="browser")
    # 立刻验一次登录态
    try:
        chk = pool.POOL.check(acc["id"])
        acc = chk.get("view") or acc
        healthy = bool(chk.get("healthy"))
    except Exception:
        healthy = False
    store.log("info", "browser", f"从浏览器导入账号 {acc.get('label')}（{ck['count']} 个 Cookie）")
    return {"account": acc, "cookies": ck["count"], "cookie_names": ck.get("names"),
            "healthy": healthy}


@app.post("/admin/api/pool/refill/browser")
async def admin_refill_browser(payload: dict = Body(default={}),
                               _: bool = Depends(require_admin)):
    """打开托管浏览器 + 起一个补号任务；用户拖一次滑块，网关自动把 token 填给任务。"""
    import browser
    job = provision.start_refill(1, str(payload.get("provider") or ""),
                                 verify=bool(payload.get("verify", True)))
    try:
        browser.BROWSER.launch(browser.REGISTER_URL)
    except Exception as e:
        store.log("warn", "browser", f"打开托管浏览器失败: {e}")
    return {"job": job.to_dict(), "browser": browser.BROWSER.status()}


@app.post("/admin/api/pool/refill")
async def admin_refill(payload: dict = Body(default={}), _: bool = Depends(require_admin)):
    job = provision.start_refill(int(payload.get("count") or 1),
                                 str(payload.get("provider") or ""),
                                 verify=bool(payload.get("verify", True)),
                                 captcha_verify=str(payload.get("captcha") or ""))
    return job.to_dict()


@app.get("/admin/api/pool/refill/{job_id}")
async def admin_refill_status(job_id: str, _: bool = Depends(require_admin)):
    job = provision.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    return job.to_dict()


@app.post("/admin/api/pool/refill/{job_id}/captcha")
async def admin_refill_captcha(job_id: str, payload: dict = Body(...),
                               _: bool = Depends(require_admin)):
    job = provision.get_job(job_id)
    if not job:
        raise HTTPException(404, "任务不存在")
    ok = job.supply_captcha(str(payload.get("captcha_verify") or payload.get("captcha") or ""))
    return {"ok": ok, "job": job.to_dict()}


@app.get("/admin/api/pool/jobs")
async def admin_refill_jobs(_: bool = Depends(require_admin)):
    return {"items": [j.to_dict() for j in list(provision.JOBS.values())[-20:]]}


@app.get("/admin/api/models")
async def admin_models(_: bool = Depends(require_admin)):
    return registry.models_view()


@app.patch("/admin/api/models/{alias}")
async def admin_model_patch(alias: str, payload: dict = Body(...), _: bool = Depends(require_admin)):
    if not registry.by_alias(alias):
        raise HTTPException(404, f"模型不存在: {alias}")
    registry.set_enabled(alias, bool(payload.get("enabled", True)),
                         payload.get("note") if "note" in payload else None)
    return {"ok": True, "models": registry.models_view()["counts"]}


@app.post("/admin/api/models/bulk")
async def admin_models_bulk(payload: dict = Body(...), _: bool = Depends(require_admin)):
    changed = registry.bulk_enabled(bool(payload.get("enabled", True)),
                                    str(payload.get("kind") or ""),
                                    payload.get("except") or [])
    view = registry.models_view()
    return {"ok": True, "changed": changed, "models": view["counts"], "items": view["items"]}


@app.get("/admin/api/settings")
async def admin_settings(_: bool = Depends(require_admin)):
    return config.SETTINGS.to_dict()


@app.put("/admin/api/settings")
async def admin_settings_put(payload: dict = Body(...), _: bool = Depends(require_admin)):
    config.SETTINGS.update(payload)
    config.save_settings(config.SETTINGS)
    store.log("info", "settings", "设置已更新")
    return config.SETTINGS.to_dict()


@app.get("/admin/api/logs")
async def admin_logs(limit: int = 200, level: str = "", _: bool = Depends(require_admin)):
    items = store.recent_logs(max(1, min(2000, limit)), level)
    return {"items": items, "total": len(items), "limit": limit, "level": level}


@app.post("/admin/api/selftest")
async def admin_selftest(_: bool = Depends(require_admin)):
    out: dict[str, Any] = {"steps": []}

    def step(name: str, ok: bool, detail: Any = None) -> None:
        out["steps"].append({"name": name, "ok": bool(ok), "detail": detail})

    up = civision.probe_reachable()
    step("上游可达", up["reachable"], up)
    mc = registry.models_view()["counts"]
    step("模型注册表", mc["enabled"] > 0, mc)
    pc = pool.POOL.count()
    step("号池", pc["available"] > 0, pc)
    step("API KEY", len(keystore.list_keys()) > 0, {"keys": len(keystore.list_keys())})
    if pc["available"]:
        acc = pool.POOL.acquire("image")
        if acc:
            try:
                h = acc.client().health()
                step("账号登录态", bool(h.get("healthy")), h)
            except Exception as e:
                step("账号登录态", False, str(e)[:300])
    out["ok"] = all(s["ok"] for s in out["steps"])
    return out


@app.get("/admin/api/jobs")
async def admin_jobs(_: bool = Depends(require_admin)):
    rows = store.q("SELECT * FROM jobs ORDER BY created DESC LIMIT 30")
    return {"items": [{**dict(r), "payload": store.jload(r["payload"], {}),
                       "steps": store.jload(r["steps"], [])} for r in rows]}


# ==================================================================== 静态 WebUI
if os.path.isdir(WEBUI_DIR):
    app.mount("/static", StaticFiles(directory=WEBUI_DIR), name="static")

    @app.get("/")
    async def index() -> Response:
        p = os.path.join(WEBUI_DIR, "index.html")
        if os.path.exists(p):
            return FileResponse(p)
        return JSONResponse({"service": "civision-gateway", "version": config.VERSION,
                             "webui": "未找到 webui/index.html",
                             "docs": "/docs", "admin": "/admin/api/overview"})

    @app.get("/{full_path:path}")
    async def spa(full_path: str) -> Response:
        if full_path.startswith(("v1/", "studio/", "admin/", "docs", "openapi.json")):
            raise HTTPException(404, "not found")
        cand = os.path.join(WEBUI_DIR, full_path)
        if os.path.isfile(cand):
            return FileResponse(cand)
        p = os.path.join(WEBUI_DIR, "index.html")
        if os.path.exists(p):
            return FileResponse(p)
        raise HTTPException(404, "not found")
else:
    @app.get("/")
    async def index_no_webui() -> Response:
        return JSONResponse({"service": "civision-gateway", "version": config.VERSION})


def main() -> None:
    import uvicorn
    uvicorn.run("app:app", host=config.SETTINGS.host, port=config.SETTINGS.port,
                log_level=config.SETTINGS.log_level, reload=False)


if __name__ == "__main__":
    main()
