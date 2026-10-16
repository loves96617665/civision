"""civision.py — 上游（modelscope.ai/civision）协议客户端。

逆向依据见 docs/PROTOCOL.md。两条通道：
  * 站内通道  base = {upstream}/api        —— 需要 Cookie 会话
  * OpenAPI 通道 base = {upstream}/openapi —— 需要 Cookie 会话或 Access Token
"""
from __future__ import annotations

import json
import re
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Optional

import httpx

import config
import store

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")

MEDIA_KEYS_IMAGE = ("output_images", "images", "image_list", "outputs")
MEDIA_KEYS_VIDEO = ("output_videos", "videos", "video_list")


class UpstreamError(RuntimeError):
    def __init__(self, message: str, *, status: int = 0, code: str = "", channel: str = "",
                 request_id: str = "", payload: Any = None):
        super().__init__(message)
        self.status = status
        self.code = code
        self.channel = channel
        self.request_id = request_id
        self.payload = payload

    @property
    def kind(self) -> str:
        low = (self.code + " " + str(self)).lower()
        if "invalidauthentication" in low or "not logged in" in low or "access forbidden" in low:
            return "auth"
        if "quota" in low or "insufficient" in low or "balance" in low:
            return "quota"
        if "rate" in low or "429" in low or "frequent" in low:
            return "rate"
        if "parameter" in low or "invalid" in low:
            return "param"
        if self.status >= 500:
            return "server"
        return "unknown"

    def to_dict(self) -> dict:
        return {
            "message": str(self),
            "status": self.status,
            "code": self.code,
            "channel": self.channel,
            "request_id": self.request_id,
            "kind": self.kind,
        }


# ------------------------------------------------------------------ 响应解析工具
def _walk(node: Any, depth: int = 0) -> Iterator[Any]:
    if depth > 12:
        return
    yield node
    if isinstance(node, dict):
        for v in node.values():
            yield from _walk(v, depth + 1)
    elif isinstance(node, list):
        for v in node:
            yield from _walk(v, depth + 1)


_URL_RE = re.compile(r"^https?://[^\s\"']+\.(?:png|jpe?g|webp|gif|bmp|mp4|webm|mov|mp3|wav|flac|m4a|ogg)(?:\?[^\s\"']*)?$", re.I)

# OSS 白名单（逆向自 upload-D1d0Zjeu.js）
_OSS_SUFFIXES = (
    ".oss-cn-beijing.aliyuncs.com", ".oss-cn-shanghai.aliyuncs.com",
    ".oss-cn-shenzhen.aliyuncs.com", ".oss-cn-hangzhou.aliyuncs.com",
    ".oss-cn-zhangjiakou.aliyuncs.com", ".oss-accelerate.aliyuncs.com",
    ".oss-ap-southeast-1.aliyuncs.com", ".modelscope.cn", ".modelscope.ai",
)


def _oss_allowlisted(url: str) -> bool:
    try:
        from urllib.parse import urlparse
        u = urlparse(url)
        if u.scheme != "https":
            return False
        host = (u.hostname or "").lower()
        return any(host == s.lstrip(".") or host.endswith(s) for s in _OSS_SUFFIXES)
    except Exception:
        return False


def _looks_media(u: Any, kind: str) -> bool:
    if not isinstance(u, str) or not u.startswith("http"):
        return False
    if kind == "video":
        return bool(re.search(r"\.(mp4|webm|mov|m4v)(\?|$)", u, re.I)) or "/video" in u.lower()
    if kind == "audio":
        return bool(re.search(r"\.(mp3|wav|flac|m4a|ogg)(\?|$)", u, re.I))
    if kind == "image":
        return bool(re.search(r"\.(png|jpe?g|webp|gif|bmp)(\?|$)", u, re.I))
    return bool(_URL_RE.match(u))


def extract_outputs(payload: Any, kind: str = "image") -> list[dict]:
    """从任意上游响应结构里抽取媒体产物（宽松递归，兼容未知字段名）。"""
    found: list[dict] = []
    seen: set[str] = set()

    def push(url: str, media_kind: str, **extra: Any) -> None:
        if not url or url in seen:
            return
        seen.add(url)
        found.append({"type": media_kind, "url": url, **{k: v for k, v in extra.items() if v}})

    def visit(node: Any, hint: str = "", depth: int = 0) -> None:
        if depth > 12:
            return
        if isinstance(node, dict):
            mk = hint
            if isinstance(node.get("media_type"), str):
                mk = node["media_type"]
            if isinstance(node.get("task_type"), str):
                tt = node["task_type"].upper()
                if "VIDEO" in tt:
                    mk = "video"
            if isinstance(node.get("type"), str) and node["type"].upper() in ("IMAGE", "VIDEO", "AUDIO"):
                mk = node["type"].lower()

            for key in ("url", "image_url", "video_url", "audio_url", "output_url", "result_url",
                        "display_url", "cover_url", "thumb_url", "download_url"):
                v = node.get(key)
                if isinstance(v, str) and v.startswith("http"):
                    k = mk or kind
                    if key == "cover_url" or key == "thumb_url":
                        continue
                    if _looks_media(v, k) or key in ("image_url", "video_url", "audio_url", "output_url"):
                        push(v, k, width=node.get("width"), height=node.get("height"),
                             video_id=node.get("video_id"), image_id=node.get("image_id"),
                             id=node.get("id"), task_id=node.get("task_id") or node.get("id"))

            for key in MEDIA_KEYS_IMAGE:
                if key in node:
                    visit(node[key], "image", depth + 1)
            for key in MEDIA_KEYS_VIDEO:
                if key in node:
                    visit(node[key], "video", depth + 1)
            for key in ("tasks", "task_output", "task", "data", "result", "results", "content",
                        "History", "messages", "Messages", "items"):
                if key in node:
                    visit(node[key], mk, depth + 1)
        elif isinstance(node, list):
            for v in node:
                visit(v, hint, depth + 1)
        elif isinstance(node, str):
            if _looks_media(node, hint or kind):
                push(node, hint or kind)

    visit(payload, kind)

    if kind == "image":
        found = [f for f in found if f["type"] == "image"] or found
    return found


def extract_status(payload: Any) -> str:
    """从响应里推断任务状态：succeeded | failed | processing | queued。"""
    states: list[str] = []
    for n in _walk(payload):
        if isinstance(n, dict):
            for key in ("status", "state", "task_status", "Status"):
                v = n.get(key)
                if isinstance(v, str) and v:
                    states.append(v.upper())
            for key in ("success", "ok"):
                if n.get(key) is False and len(n) <= 4:
                    states.append("FAILED")
    if not states:
        return ""
    joined = " ".join(states)
    if any(s in joined for s in ("FAILED", "CANCELLED", "CANCELED", "ERROR", "TIMEOUT")):
        return "failed"
    if any(s in joined for s in ("SUCCEED", "SUCCESS", "FINISH", "COMPLETE", "DONE")):
        return "succeeded"
    if any(s in joined for s in ("RUNNING", "PROCESSING", "GENERATING", "PENDING", "QUEUED", "IN_PROGRESS", "WAITING")):
        return "processing"
    return ""


def extract_error(payload: Any) -> str:
    for n in _walk(payload):
        if isinstance(n, dict):
            for key in ("message", "msg", "error_message", "errorMessage", "error", "detail"):
                v = n.get(key)
                if isinstance(v, str) and v.strip():
                    return v.strip()[:500]
                if isinstance(v, dict):
                    for kk in ("message", "msg", "detail"):
                        if isinstance(v.get(kk), str) and v[kk].strip():
                            return v[kk].strip()[:500]
    return ""


# ------------------------------------------------------------------ 客户端
@dataclass
class ClientOptions:
    cookie: str = ""
    token: str = ""            # ModelScope Access Token（可选，替代 Cookie）
    label: str = ""
    proxy: str = ""
    timeout: float = 180.0


@dataclass
class ClientState:
    calls: int = 0
    errors: int = 0
    last_status: int = 0
    last_error: str = ""
    last_latency_ms: int = 0
    extra: dict = field(default_factory=dict)


class CivisionClient:
    """一个上游账号的协议封装。线程内复用 httpx.Client。"""

    def __init__(self, opts: ClientOptions):
        self.opts = opts
        self.state = ClientState()
        self._client: Optional[httpx.Client] = None

    # -------------------------------------------------- 基础
    @property
    def base(self) -> str:
        return config.SETTINGS.upstream_base.rstrip("/")

    def _http(self) -> httpx.Client:
        if self._client is None:
            headers = {
                "User-Agent": UA,
                "Accept": "application/json, text/plain, */*",
                "Accept-Language": config.SETTINGS.accept_language,
                "Origin": self.base,
                "Referer": self.base + "/civision/image-generation",
                "bx-v": config.SETTINGS.bx_v,
                "X-ModelScope-Accept-Language": config.SETTINGS.accept_language,
            }
            if self.opts.cookie:
                headers["Cookie"] = self.opts.cookie
            if self.opts.token:
                headers["Authorization"] = f"Bearer {self.opts.token}"
            csrf = self._csrf_from_cookie()
            if csrf:
                headers["X-CSRF-TOKEN"] = csrf
            kw: dict[str, Any] = {
                "headers": headers,
                "timeout": httpx.Timeout(self.opts.timeout, connect=config.SETTINGS.connect_timeout),
                "follow_redirects": True,
                "verify": True,
            }
            if self.opts.proxy or config.SETTINGS.proxy:
                kw["proxy"] = self.opts.proxy or config.SETTINGS.proxy
            self._client = httpx.Client(**kw)
        return self._client

    def close(self) -> None:
        if self._client is not None:
            try:
                self._client.close()
            except Exception:
                pass
            self._client = None

    def _csrf_from_cookie(self) -> str:
        m = re.search(r"(?:^|;\s*)csrf_token=([^;]+)", self.opts.cookie or "")
        return m.group(1) if m else ""

    def _trace_id(self) -> str:
        return uuid.uuid4().hex

    # -------------------------------------------------- 请求
    def request(self, method: str, path: str, *, json_body: Any = None, params: dict | None = None,
                absolute: bool = False, stream: bool = False, accept: str = "",
                extra_headers: dict | None = None, retries: int = 1) -> Any:
        url = (self.base + path) if absolute else (self.base + "/api" + path)
        headers = {"X-ModelScope-Trace-Id": self._trace_id()}
        if accept:
            headers["Accept"] = accept
        if json_body is not None:
            headers["Content-Type"] = "application/json"
        if extra_headers:
            headers.update(extra_headers)

        last_exc: Optional[Exception] = None
        for attempt in range(retries + 1):
            t0 = time.time()
            try:
                resp = self._http().request(method, url, json=json_body, params=params,
                                            headers=headers)
                self.state.calls += 1
                self.state.last_status = resp.status_code
                self.state.last_latency_ms = int((time.time() - t0) * 1000)
                if stream:
                    return resp
                return self._handle(resp, path)
            except httpx.HTTPError as e:
                last_exc = e
                self.state.errors += 1
                self.state.last_error = f"{type(e).__name__}: {e}"
                if attempt < retries:
                    time.sleep(0.6 * (attempt + 1))
                    continue
                raise UpstreamError(self.state.last_error, status=0, code="TransportError") from e
        raise UpstreamError(str(last_exc), status=0, code="TransportError")

    def _handle(self, resp: httpx.Response, path: str) -> Any:
        text = resp.text
        try:
            data = resp.json()
        except Exception:
            data = {"_raw": text[:2000]}

        if resp.status_code >= 400:
            code = ""
            msg = ""
            rid = ""
            if isinstance(data, dict):
                code = str(data.get("code") or data.get("Code") or "")
                msg = str(data.get("message") or data.get("Message") or data.get("msg") or "")
                rid = str(data.get("request_id") or data.get("RequestId") or "")
            self.state.errors += 1
            self.state.last_error = msg or f"HTTP {resp.status_code}"
            raise UpstreamError(
                msg or f"upstream HTTP {resp.status_code} on {path}",
                status=resp.status_code, code=code or f"HTTP{resp.status_code}",
                request_id=rid, payload=data)

        # 站内通道业务码
        if isinstance(data, dict):
            biz = data.get("Code")
            ok = data.get("Success")
            if isinstance(biz, int) and biz not in (200,) and ok is False:
                msg = str(data.get("Message") or data.get("msg") or "")
                self.state.errors += 1
                self.state.last_error = msg
                raise UpstreamError(msg or f"upstream business code {biz}", status=resp.status_code,
                                    code=str(biz), request_id=str(data.get("RequestId") or ""),
                                    payload=data)
            if data.get("success") is False:
                msg = str(data.get("message") or "")
                self.state.errors += 1
                self.state.last_error = msg
                raise UpstreamError(msg or "upstream returned success=false",
                                    status=resp.status_code,
                                    code=str(data.get("code") or ""),
                                    request_id=str(data.get("request_id") or ""), payload=data)
        return data

    # -------------------------------------------------- 只读
    def catalog(self) -> dict:
        """公开模型目录（无需登录）。"""
        return self.request("GET", "/v1/muse/predict/unauth/defaultTemplateV2")

    def login_info(self) -> dict:
        return self.request("GET", "/v1/users/login/info")

    def user_info(self) -> dict:
        return self.request("GET", "/v1/users/info")

    def rate_limit(self) -> dict:
        return self.request("GET", "/v1/inference/rate-limit")

    def magicube_balance(self) -> dict:
        return self.request("GET", "/openapi/v1/magicubes/balance", absolute=True)

    def estimate_quota(self, kind: str = "IMAGE", extra: dict | None = None) -> Optional[int]:
        body = {"type": kind.upper(), **(extra or {})}
        try:
            data = self.request("POST", "/openapi/v1/aigc/agentic/estimate-quota",
                                json_body=body, absolute=True)
        except UpstreamError:
            return None
        q = ((data or {}).get("data") or {}).get("quota")
        return int(q) if isinstance(q, (int, float)) else None

    def byok_models(self) -> dict:
        return self.request("GET", "/openapi/v1/byok/models", absolute=True)

    def health(self) -> dict:
        """账号健康检查：登录态 + 额度。"""
        out: dict[str, Any] = {"healthy": False, "email": "", "quota": {}, "checked_at": time.time()}
        try:
            info = self.login_info()
            d = (info or {}).get("Data") or {}
            out["healthy"] = True
            out["email"] = d.get("Email") or d.get("Name") or ""
            out["user"] = d.get("Name") or ""
        except UpstreamError as e:
            out["error"] = str(e)
            out["kind"] = e.kind
            return out
        for kind in ("IMAGE", "VIDEO"):
            q = self.estimate_quota(kind)
            if q is not None:
                out["quota"][kind.lower()] = q
        try:
            bal = (self.magicube_balance() or {}).get("data") or {}
            out["quota"]["balance"] = bal.get("available_balance") or bal.get("total_balance")
        except UpstreamError:
            pass
        return out

    # -------------------------------------------------- 图片生成
    @staticmethod
    def build_image_body(*, model: str, prompt: str, width: int, height: int,
                         quantity: int = 1, negative_prompt: str = "",
                         lora: list[dict] | None = None, image: str = "",
                         strength: float = 1.0, mode: str = "custom",
                         predict_type: str = "", extra_basic: dict | None = None) -> dict:
        pt = predict_type or ("IMG_2_IMG" if image else "TXT_2_IMG")
        basic: dict[str, Any] = {"width": int(width), "height": int(height),
                                 "num_images_per_prompt": int(quantity)}
        for k, v in (extra_basic or {}).items():
            if v is not None:
                basic[k] = v
        prompt_args: dict[str, Any] = {"prompt": prompt}
        if negative_prompt:
            prompt_args["negative_prompt"] = negative_prompt
        model_args: dict[str, Any] = {"model": model}
        if lora:
            model_args["lora_args"] = lora
        body: dict[str, Any] = {
            "type": "IMAGE",
            "mode": mode,
            "predict_task_request": {
                "predict_type": pt,
                "prompt_args": prompt_args,
                "basic_diffusion_args": basic,
                "model_args": model_args,
            },
        }
        if image:
            body["predict_task_request"]["image_input_front_args"] = {
                "image": image, "strength": float(strength)}
        return body

    def image_generate(self, body: dict) -> Any:
        return self.request("POST", "/v1/aigc/agentic/image/generate", json_body=body)

    # -------------------------------------------------- 视频生成
    @staticmethod
    def build_video_body(*, version_id: int, prompt: str, width: int, height: int,
                         total_seconds: float = 5, lora: list[dict] | None = None,
                         image: str = "", references: list[dict] | None = None,
                         predict_type: str = "", basic: dict | None = None,
                         mode: str = "custom", image_id: str = "") -> dict:
        refs = list(references or [])
        if image:
            refs.insert(0, {"type": "IMAGE", "image": image,
                            **({"image_id": image_id} if image_id else {})})
        pt = predict_type or ("IMG_2_VIDEO" if refs else "TXT_2_VIDEO")
        basic_args: dict[str, Any] = dict(basic or {})
        basic_args.update({"seed": basic_args.get("seed", -1),
                           "total_seconds": float(total_seconds),
                           "width": int(width), "height": int(height)})
        model_args: dict[str, Any] = {"checkpoint_model_version_id": int(version_id)}
        if lora:
            model_args["lora_args"] = lora
        req: dict[str, Any] = {
            "predict_type": pt,
            "prompt_args": {"prompt": prompt},
            "basic_diffusion_args": basic_args,
            "model_args": model_args,
        }
        if refs:
            req["video_inference_args"] = {"mode": "REF2VA",
                                           "accelerateLora": bool(basic_args.get("accelerateLora")),
                                           "references": refs}
        return {"type": "VIDEO", "mode": mode, "video_predict_task_request": req}

    def video_generate(self, body: dict) -> Any:
        return self.request("POST", "/openapi/v1/aigc/agentic/video/generate",
                            json_body=body, absolute=True)

    # -------------------------------------------------- 音乐生成
    # ⚠️ 音频链路未在公开 chunk 中找到独立的 fetch 调用，这里按 image/video 的同构
    #    predict_task_request 结构推断（type=AUDIO + audio_predict_task_request），
    #    参数名取自 registry 里 ACESTEP_XL / MINIMAX_MUSIC3 的 basicDiffusionArgs。
    @staticmethod
    def build_audio_body(*, prompt: str, basic: dict | None = None,
                         lyrics: str = "", mode: str = "custom",
                         predict_type: str = "TXT_2_AUDIO") -> dict:
        args = dict(basic or {})
        if lyrics:
            args["lyrics"] = lyrics
        return {
            "type": "AUDIO",
            "mode": mode,
            "audio_predict_task_request": {
                "predict_type": predict_type,
                "prompt_args": {"prompt": prompt},
                "basic_diffusion_args": args,
            },
        }

    def audio_generate(self, body: dict) -> Any:
        return self.request("POST", "/v1/aigc/agentic/audio/generate", json_body=body)

    # -------------------------------------------------- Agent 会话
    def create_conversation(self, title: str = "") -> dict:
        return self.request("POST", "/v1/aigc/agentic/conversations",
                            json_body={"title": title})

    def list_conversations(self, page: int = 1, page_size: int = 20) -> dict:
        return self.request("GET", f"/v1/aigc/agentic/conversations?page={page}&page_size={page_size}")

    def get_conversation(self, uuid_: str) -> dict:
        return self.request("GET", f"/v1/aigc/agentic/conversations/{uuid_}")

    def get_message(self, message_id: str) -> dict:
        return self.request("GET", f"/v1/aigc/agentic/messages/{message_id}")

    def task_status(self, message_id: str) -> dict:
        return self.request("GET", f"/v1/aigc/agentic/messages/{message_id}/tasks/status")

    def stop_conversation(self, uuid_: str) -> dict:
        return self.request("POST", f"/v1/aigc/agentic/conversations/{uuid_}/stop")

    def agent_stream(self, uuid_: str, *, prompt: str, images: list[Any] | None = None,
                     image_ratio: dict | None = None, timeout: float | None = None) -> Iterator[dict]:
        """SSE 流：yield {"event":..., "data":...}。"""
        body = {"prompt": prompt, "images": images or [], "image_ratio": image_ratio or {}}
        resp = self.request(
            "POST", f"/v1/aigc/agentic/conversations/{uuid_}/generate",
            json_body=body, stream=True,
            accept="text/event-stream",
            extra_headers={"x-no-compression": "1", "Cache-Control": "no-cache"})
        try:
            for raw in resp.iter_lines():
                if not raw:
                    continue
                line = raw.strip()
                if line.startswith("data:"):
                    line = line[5:].strip()
                elif line.startswith("event:"):
                    continue
                if not line or line == "[DONE]":
                    continue
                try:
                    obj = json.loads(line)
                except Exception:
                    continue
                yield obj if isinstance(obj, dict) else {"data": obj}
        finally:
            resp.close()

    # -------------------------------------------------- 媒体上传（OSS 三段式）
    # 逆向自 upload-D1d0Zjeu.js / common-15R4c2zf.js / ossType-vMUbgUmS.js：
    #   1) POST /v1/rm/uploadUrl   {FileName, Type, ContentType?} -> {Data:{UploadUrl, Callback}}
    #   2) PUT  <UploadUrl>        body=bytes, headers: x-oss-meta-author: aliy [, x-oss-callback]
    #   3) POST /v1/rm/downloadUrl {FileUrl, Type}                -> {Data:{DownloadUrl}}
    OSS_TYPES = (
        "DEMO", "STUDIO", "ACTIVE_IMAGE", "COMMENT_PICTURE", "STUDIO_COVER", "RACE_SCRIPT",
        "RACE_RESULT", "RACE_IMAGE", "RACE_LEAERBOARD", "RACE_LEADERBOARD", "AVATAR",
        "TOOL_BOX_README", "OPERATION_VIDEO", "THEME_IMAGE", "THEME_VIDEO", "ACTIVE_TEXT",
        "AIGC_COVER_IMAGE", "AIGC_COVER_VIDEO", "WORKFLOW_IMAGE", "AIGC_TRAIN_IMG",
        "COLLECTION_IMAGE", "AIGC_MUSE_IMG", "AGENT_TOOL", "AIGC_MUSE_IMG_PRIVATEZONE",
        "MCP_SERVER_COVER", "AGENT_CHAT", "MODEL_COVER", "DATASET_COVER", "AIGC_TAG_IMAGE",
        "AIGC_SEARCH_IMG",
    )

    def upload_url(self, filename: str, type_: str = "AIGC_MUSE_IMG",
                   content_type: str = "") -> dict:
        body: dict[str, Any] = {"FileName": filename, "Type": type_}
        if content_type:
            body["ContentType"] = content_type
        return self.request("POST", "/v1/rm/uploadUrl", json_body=body)

    def download_url(self, file_url: str, type_: str = "AIGC_MUSE_IMG") -> dict:
        return self.request("POST", "/v1/rm/downloadUrl",
                            json_body={"FileUrl": file_url, "Type": type_})

    def upload_bytes(self, filename: str, data: bytes, content_type: str = "application/octet-stream",
                     type_: str = "AIGC_MUSE_IMG") -> dict:
        """三段式上传，返回 {file_url, download_url, upload_url}。"""
        r1 = self.upload_url(filename, type_, content_type)
        d1 = (r1 or {}).get("Data") or {}
        up = d1.get("UploadUrl") or ""
        if not up:
            raise UpstreamError(f"uploadUrl 未返回 UploadUrl: {r1}", code="UploadError")
        if not _oss_allowlisted(up):
            raise UpstreamError(f"上传地址不在 OSS 白名单内: {up[:120]}", code="SecurityError")

        headers = {"Content-Type": content_type or "application/octet-stream",
                   "x-oss-meta-author": "aliy"}
        if d1.get("Callback"):
            headers["x-oss-callback"] = d1["Callback"]
        t0 = time.time()
        try:
            resp = self._http().put(up, content=data, headers=headers)
        except httpx.HTTPError as e:
            raise UpstreamError(f"OSS PUT 失败: {e}", code="TransportError") from e
        if resp.status_code >= 400:
            raise UpstreamError(f"OSS PUT -> HTTP {resp.status_code}: {resp.text[:200]}",
                                status=resp.status_code, code="UploadError")
        file_url = up.split("?")[0]
        dl = ""
        try:
            r3 = self.download_url(file_url, type_)
            dl = ((r3 or {}).get("Data") or {}).get("DownloadUrl") or ""
        except UpstreamError:
            pass
        self.state.calls += 1
        return {"file_url": file_url, "download_url": dl or file_url,
                "upload_url": up, "elapsed_ms": int((time.time() - t0) * 1000)}

    def register_media(self, items: list[dict]) -> Any:
        """把已上传的资源登记到 AIGC 媒体库（/api/v1/image/create）。"""
        return self.request("POST", "/v1/image/create",
                            json_body={"data": items})

    # -------------------------------------------------- 通用生成（带轮询）
    def generate(self, kind: str, body: dict, *, poll: bool = True,
                 timeout: float | None = None,
                 on_progress: Callable[[dict], None] | None = None) -> dict:
        """统一入口：返回 {status, outputs, upstream, message_id, conversation, elapsed}。"""
        timeout = timeout or config.SETTINGS.timeout
        t0 = time.time()
        result: dict[str, Any] = {"status": "processing", "outputs": [], "upstream": None,
                                  "message_id": "", "conversation": "", "elapsed": 0.0}

        if kind == "image":
            data = self.image_generate(body)
        elif kind == "video":
            data = self.video_generate(body)
        elif kind == "audio":
            data = self.audio_generate(body)
        else:
            raise UpstreamError(f"unsupported kind: {kind}", code="InputParameterError")

        result["upstream"] = data
        result["message_id"] = _first_str(data, ("message_id", "messageId", "id", "task_id"))
        result["conversation"] = _first_str(data, ("conversation_uuid", "conversationUuid"))

        outputs = extract_outputs(data, kind)
        status = extract_status(data) or ("succeeded" if outputs else "processing")
        if outputs and status != "failed":
            result["status"] = "succeeded"
            result["outputs"] = outputs
            result["elapsed"] = round(time.time() - t0, 2)
            return result
        if status == "failed":
            result["status"] = "failed"
            result["error"] = extract_error(data)
            return result

        if not poll or not result["message_id"]:
            result["elapsed"] = round(time.time() - t0, 2)
            return result

        # 轮询
        interval = max(1.0, config.SETTINGS.poll_interval)
        while time.time() - t0 < timeout:
            time.sleep(interval)
            interval = min(interval * 1.25, 8.0)
            try:
                st = self.task_status(result["message_id"])
            except UpstreamError as e:
                if e.kind in ("auth", "param"):
                    raise
                continue
            result["upstream"] = st
            if on_progress:
                try:
                    on_progress(st)
                except Exception:
                    pass
            outputs = extract_outputs(st, kind)
            status = extract_status(st)
            if outputs and status != "failed":
                result["status"] = "succeeded"
                result["outputs"] = outputs
                result["elapsed"] = round(time.time() - t0, 2)
                return result
            if status == "failed":
                result["status"] = "failed"
                result["error"] = extract_error(st)
                result["elapsed"] = round(time.time() - t0, 2)
                return result

        result["status"] = "timeout"
        result["error"] = f"生成超时（{int(timeout)}s）"
        result["elapsed"] = round(time.time() - t0, 2)
        return result


def _first_str(node: Any, keys: tuple[str, ...]) -> str:
    for n in _walk(node):
        if isinstance(n, dict):
            for k in keys:
                v = n.get(k)
                if isinstance(v, str) and v and len(v) < 200:
                    return v
                if isinstance(v, int):
                    return str(v)
    return ""


# ------------------------------------------------------------------ 静态（无凭证）工具
def fetch_catalog(upstream: str = "") -> dict:
    c = CivisionClient(ClientOptions(timeout=45))
    if upstream:
        c.opts.cookie = ""
    try:
        return c.catalog()
    finally:
        c.close()


def probe_reachable(upstream: str = "") -> dict:
    t0 = time.time()
    c = CivisionClient(ClientOptions(timeout=30))
    out = {"reachable": False, "latency_ms": 0, "error": ""}
    try:
        c.catalog()
        out["reachable"] = True
    except Exception as e:
        out["error"] = str(e)[:300]
    finally:
        out["latency_ms"] = int((time.time() - t0) * 1000)
        c.close()
    return out
