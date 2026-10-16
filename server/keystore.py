"""keystore.py — 网关 API KEY 管理（明文只返回一次，库里存 sha256）。"""
from __future__ import annotations

import hashlib
import json
import secrets
import time
from datetime import date
from typing import Optional

import store

PREFIX = "sk-civ-"


def _hash(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def create_key(name: str, *, note: str = "", models: Optional[list[str]] = None,
               rpm: int = 0, quota: int = 0) -> dict:
    raw = PREFIX + secrets.token_hex(16)
    kid = "key_" + secrets.token_hex(6)
    store.execute(
        "INSERT INTO api_keys (id,name,key_hash,key_prefix,key_tail,enabled,models,rpm,quota,"
        "used,note,created,last_used) VALUES (?,?,?,?,?,1,?,?,?,0,?,?,0)",
        (kid, name or "default", _hash(raw), PREFIX + raw[len(PREFIX):len(PREFIX) + 6],
         raw[-4:], store.jdump(models or ["*"]), int(rpm), int(quota), note or "", time.time()))
    store.log("info", "keys", f"创建 API KEY {name}", id=kid)
    return {**get_key(kid, with_secret=True), "key": raw}


def _view(r) -> dict:
    return {
        "id": r["id"], "name": r["name"], "prefix": r["key_prefix"], "tail": r["key_tail"],
        # last4 是前端表头用的别名，与 tail 同值，保留两者避免客户端踩字段名
        "last4": r["key_tail"],
        "enabled": bool(r["enabled"]), "models": store.jload(r["models"], ["*"]),
        "rpm": r["rpm"], "quota": r["quota"], "used": r["used"], "note": r["note"],
        "created": r["created"], "last_used": r["last_used"],
        "masked": f"{r['key_prefix']}...{r['key_tail']}",
    }


def list_keys() -> list[dict]:
    return [_view(r) for r in store.q("SELECT * FROM api_keys ORDER BY created DESC")]


def get_key(kid: str, with_secret: bool = False) -> Optional[dict]:
    r = store.q1("SELECT * FROM api_keys WHERE id=?", (kid,))
    return _view(r) if r else None


def find_by_secret(raw: str) -> Optional[dict]:
    if not raw:
        return None
    r = store.q1("SELECT * FROM api_keys WHERE key_hash=?", (_hash(raw.strip()),))
    return _view(r) if r else None


def patch_key(kid: str, patch: dict) -> Optional[dict]:
    r = store.q1("SELECT * FROM api_keys WHERE id=?", (kid,))
    if not r:
        return None
    sets, args = [], []
    for col, key in (("name", "name"), ("note", "note"), ("rpm", "rpm"), ("quota", "quota")):
        if patch.get(key) is not None:
            sets.append(f"{col}=?")
            args.append(patch[key] if key in ("name", "note") else int(patch[key]))
    if patch.get("enabled") is not None:
        sets.append("enabled=?")
        args.append(1 if patch["enabled"] else 0)
    if patch.get("models") is not None:
        sets.append("models=?")
        args.append(store.jdump(patch["models"]))
    if not sets:
        return get_key(kid)
    args.append(kid)
    store.execute(f"UPDATE api_keys SET {','.join(sets)} WHERE id=?", args)
    return get_key(kid)


def delete_key(kid: str) -> bool:
    store.execute("DELETE FROM api_keys WHERE id=?", (kid,))
    store.execute("DELETE FROM usage WHERE key_id=?", (kid,))
    return True


def reset_usage(kid: str) -> Optional[dict]:
    store.execute("UPDATE api_keys SET used=0 WHERE id=?", (kid,))
    store.execute("DELETE FROM usage WHERE key_id=?", (kid,))
    return get_key(kid)


def touch(kid: str) -> None:
    store.execute("UPDATE api_keys SET used=used+1, last_used=? WHERE id=?", (time.time(), kid))
    today = date.today().isoformat()
    store.execute("INSERT INTO usage (key_id,day,count) VALUES (?,?,1) "
                  "ON CONFLICT(key_id,day) DO UPDATE SET count=count+1", (kid, today))


def usage_today(kid: str) -> int:
    r = store.q1("SELECT count FROM usage WHERE key_id=? AND day=?",
                 (kid, date.today().isoformat()))
    return int(r["count"]) if r else 0


def model_allowed(key_view: dict, alias: str) -> bool:
    models = key_view.get("models") or ["*"]
    if "*" in models:
        return True
    return alias in models


def ensure_default_key() -> Optional[dict]:
    """首次启动且无任何 KEY 时，生成一把默认 KEY 并打印一次。"""
    if store.q1("SELECT id FROM api_keys LIMIT 1"):
        return None
    k = create_key("default", note="首次启动自动生成")
    return k
