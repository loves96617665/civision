"""registry.py — 模型注册表：别名、开关、目录（数据源 = data/registry.json，逆向自上游）。"""
from __future__ import annotations

import json
import os
import re
import time
from typing import Any, Optional

import store
from config import DATA_DIR

REGISTRY_FILE = os.path.join(DATA_DIR, "registry.json")

_cache: Optional[dict] = None


# ------------------------------------------------------------------ 别名
def _slug(text: str) -> str:
    s = text.lower().strip()
    s = re.sub(r"[^a-z0-9\.\-_]+", "-", s)
    s = re.sub(r"-{2,}", "-", s).strip("-")
    return s or "model"


def _alias_for(entry: dict) -> str:
    """别名规则：仓库名优先（可读、与源站模型页一致）。

    仓库名带数字前缀（`MusePublic/14_ckpt_SD_1_5` 这类）时读不出语义，
    退回 `sub_label`（`stable-diffusion-v1-5`）再退回 `sub_version`。
    """
    repo = (entry.get("model") or "").split("/")[-1]
    if repo and not re.match(r"^\d", repo):
        return _slug(repo)
    for cand in (entry.get("sub_label"), entry.get("sub_version"), entry.get("sd_version"), repo):
        if cand:
            s = _slug(str(cand))
            if s and s != "model":
                return s
    return _slug(repo or "model")


# ------------------------------------------------------------------ 载入
def load_raw() -> dict:
    with open(REGISTRY_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _all_entries(raw: dict) -> list[dict]:
    out: list[dict] = []
    for kind in ("image", "video", "audio"):
        for e in raw.get(kind) or []:
            e = dict(e)
            e["kind"] = kind
            out.append(e)
    return out


def _build() -> dict:
    raw = load_raw()
    entries = _all_entries(raw)
    seen: dict[str, int] = {}
    for e in entries:
        a = _alias_for(e)
        if a in seen:
            seen[a] += 1
            a = f"{a}-{e.get('sub_version', seen[a]).lower()}"
        seen[a] = seen.get(a, 0)
        e["alias"] = a
    return {
        "raw": raw,
        "entries": entries,
        "defaults": raw.get("defaults") or {},
        "by_alias": {e["alias"]: e for e in entries},
    }


def reg() -> dict:
    global _cache
    if _cache is None:
        _cache = _build()
    return _cache


def refresh() -> dict:
    global _cache
    _cache = _build()
    return _cache


def entries() -> list[dict]:
    return reg()["entries"]


def by_alias(alias: str) -> Optional[dict]:
    return reg()["by_alias"].get(alias)


def resolve(name: str) -> Optional[dict]:
    """按别名 / sd_version / sub_version / model 仓库名解析模型。"""
    if not name:
        return None
    r = reg()
    if name in r["by_alias"]:
        return r["by_alias"][name]
    low = name.lower()
    for e in r["entries"]:
        if low in (str(e.get("sd_version", "")).lower(), str(e.get("sub_version", "")).lower()):
            return e
    for e in r["entries"]:
        if low == str(e.get("model", "")).lower() or low == str(e.get("model", "")).split("/")[-1].lower():
            return e
    return None


def default_for(kind: str) -> Optional[dict]:
    dv = (reg()["defaults"] or {}).get(kind) or ""
    if not dv:
        return None
    for e in reg()["entries"]:
        if e["kind"] == kind and dv.lower() in (str(e.get("sd_version", "")).lower(),
                                                str(e.get("sub_version", "")).lower()):
            return e
    return None


def sizes_of(entry: dict) -> list[dict]:
    if entry["kind"] == "image":
        return entry.get("sizes") or []
    if entry["kind"] == "video":
        large = entry.get("sizes_large") or []
        small = entry.get("sizes_small") or []
        if large and small:
            return large + [s for s in small if s not in large]
        return large or small
    return []


# ------------------------------------------------------------------ 数据库同步
def seed_db(force: bool = False) -> int:
    """把注册表灌进 models 表；已存在的保留 enabled / note（除非 force）。

    同时清理别名已变更留下的孤儿行（例如别名规则升级后）。
    """
    store.init()
    existing = {r["alias"] for r in store.q("SELECT alias FROM models")}
    now_rows = []
    for i, e in enumerate(entries()):
        if e["alias"] in existing and not force:
            continue
        now_rows.append((
            e["alias"], e["kind"], e.get("sd_version", ""), e.get("sub_version", ""),
            e.get("label", ""), e.get("sub_label", ""), int(e.get("version_id") or 0),
            e.get("model", ""), 1, "", i,
        ))
    if now_rows:
        store.executemany(
            "INSERT OR IGNORE INTO models (alias,kind,sd_version,sub_version,label,sub_label,"
            "version_id,model,enabled,note,sort) VALUES (?,?,?,?,?,?,?,?,?,?,?)", now_rows)

    # 清理孤儿行
    live = {e["alias"] for e in entries()}
    orphans = [a for a in existing if a not in live]
    for a in orphans:
        store.execute("DELETE FROM models WHERE alias=?", (a,))
    if orphans:
        store.log("info", "registry", f"清理 {len(orphans)} 个失效别名: {orphans[:6]}")
    return len(now_rows)


def _state() -> dict[str, dict]:
    return {r["alias"]: dict(r) for r in store.q("SELECT * FROM models")}


def catalog(only_enabled: bool = False) -> dict:
    st = _state()
    out: dict[str, list] = {"image": [], "video": [], "audio": []}
    for e in entries():
        row = st.get(e["alias"], {})
        enabled = bool(row.get("enabled", 1))
        if only_enabled and not enabled:
            continue
        out[e["kind"]].append({
            "alias": row.get("alias") or e["alias"],
            "kind": e["kind"],
            "sd_version": e.get("sd_version"),
            "sub_version": e.get("sub_version"),
            "label": e.get("label"),
            "sub_label": e.get("sub_label"),
            "version_id": e.get("version_id"),
            "model": e.get("model"),
            "model_url": e.get("model_url"),
            "sizes": sizes_of(e),
            "default_params": e.get("default_params") or {},
            "support_sampler": e.get("support_sampler"),
            "max_pic_size": e.get("max_pic_size"),
            "gen_type": e.get("gen_type"),
            "support_type": e.get("support_type"),
            "enabled": enabled,
            "note": row.get("note", ""),
            "trainable": e.get("trainable"),
            "controlnet_disable": e.get("controlnet_disable"),
            "limits": e.get("limits"),
            "allowed": e.get("allowed"),
        })
    return out


def full_catalog() -> dict:
    raw = reg()["raw"]
    cat = catalog()
    defaults = reg()["defaults"] or {}

    # 站点默认：优先 config 里指定的别名，否则用上游 defaultSdVersion 映射
    import config as _cfg
    pref = {"image": _cfg.SETTINGS.default_image_model,
            "video": _cfg.SETTINGS.default_video_model,
            "audio": ""}
    def_alias = {}
    for kind in ("image", "video", "audio"):
        alias = ""
        if pref[kind]:
            e = resolve(pref[kind])
            if e and e["kind"] == kind:
                alias = e["alias"]
        if not alias:
            d = default_for(kind)
            alias = d["alias"] if d else (cat[kind][0]["alias"] if cat[kind] else "")
        def_alias[kind] = alias

    return {
        **cat,
        "defaults": {
            "image": def_alias["image"],
            "video": def_alias["video"],
            "audio": def_alias["audio"],
            "upstream_image": defaults.get("image"),
            "upstream_video": defaults.get("video"),
            "image_request": defaults.get("image_request"),
            "video_request": defaults.get("video_request"),
        },
        "ratios": {k: (cat[k][0]["sizes"] if cat[k] else []) for k in cat},
        "loras": raw.get("qwen_image_edit") or [],
        "flux_highres": raw.get("flux_highres"),
        "flux_kontext": raw.get("flux_kontext"),
    }


def set_enabled(alias: str, enabled: bool, note: Optional[str] = None) -> bool:
    sets = ["enabled=?"]
    args: list[Any] = [1 if enabled else 0]
    if note is not None:
        sets.append("note=?")
        args.append(note)
    args.append(alias)
    store.execute(f"UPDATE models SET {','.join(sets)} WHERE alias=?", args)
    return store.q1("SELECT alias FROM models WHERE alias=?", (alias,)) is not None


def bulk_enabled(enabled: bool, kind: str = "", except_aliases: Optional[list[str]] = None) -> int:
    sql = "UPDATE models SET enabled=? WHERE 1=1"
    args: list[Any] = [1 if enabled else 0]
    if kind:
        sql += " AND kind=?"
        args.append(kind)
    for a in except_aliases or []:
        sql += " AND alias<>?"
        args.append(a)
    before = store.q1("SELECT COUNT(*) AS n FROM models WHERE enabled=?",
                      (1 if enabled else 0,))
    store.execute(sql, args)
    after = store.q1("SELECT COUNT(*) AS n FROM models WHERE enabled=?", (1 if enabled else 0,))
    return int(after["n"]) - int(before["n"]) if (before and after) else 0


def models_view() -> dict:
    """管理台用的全量视图（含未启用）。"""
    st = _state()
    items = []
    for e in entries():
        row = st.get(e["alias"], {})
        items.append({
            "alias": e["alias"],
            "kind": e["kind"],
            "sd_version": e.get("sd_version"),
            "sub_version": e.get("sub_version"),
            "label": e.get("label"),
            "sub_label": e.get("sub_label"),
            "version_id": e.get("version_id"),
            "model": e.get("model"),
            "enabled": bool(row.get("enabled", 1)),
            "note": row.get("note", ""),
            "sizes": sizes_of(e),
            "default_params": e.get("default_params") or {},
        })
    order = {"image": 0, "video": 1, "audio": 2}
    items.sort(key=lambda x: (order.get(x["kind"], 9), x["label"] or "", x["sub_label"] or ""))
    counts = {"total": len(items), "enabled": sum(1 for i in items if i["enabled"])}
    return {"items": items, "counts": counts}


def public_models() -> list[dict]:
    """OpenAI /v1/models 用。"""
    now = int(time.time())
    out = []
    for m in catalog(only_enabled=True)["image"] + catalog(only_enabled=True)["video"] + \
            catalog(only_enabled=True)["audio"]:
        out.append({
            "id": m["alias"],
            "object": "model",
            "created": now,
            "owned_by": "civision",
            "meta": {
                "kind": m["kind"],
                "sd_version": m["sd_version"],
                "sub_version": m["sub_version"],
                "version_id": m["version_id"],
                "model": m["model"],
                "label": m["label"],
                "sub_label": m["sub_label"],
                "sizes": m["sizes"],
                "default_params": m["default_params"],
            },
        })
    return out


def default_params_for(entry: dict) -> dict:
    """展平 default_params -> 前端/网关统一参数名。"""
    dp = entry.get("default_params") or {}
    basic = dp.get("basicDiffusionArgs") or dp.get("basic_diffusion_args") or {}
    return {
        "width": basic.get("width"),
        "height": basic.get("height"),
        "steps": basic.get("numInferenceSteps") or basic.get("num_inference_steps"),
        "guidance_scale": basic.get("guidanceScale") or basic.get("guidance_scale"),
        "sampler": basic.get("sampler"),
        "seed": basic.get("seed", -1),
        "quantity": basic.get("numImagesPerPrompt") or basic.get("num_images_per_prompt", 1),
        "total_seconds": basic.get("totalSeconds") or basic.get("total_seconds"),
        "raw_basic": basic,
    }
