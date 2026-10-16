"""pool.py — 上游账号号池：多号轮换、故障转移、冷却、能力卡、自动补号。"""
from __future__ import annotations

import secrets
import threading
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import civision
import config
import registry
import store


class PoolExhausted(RuntimeError):
    """号池无可用账号。"""


class ModelDowngraded(RuntimeError):
    """strict 模式下，上游把请求的模型降级了。"""


@dataclass
class Account:
    id: str
    label: str = ""
    email: str = ""
    cookie: str = ""
    token: str = ""
    password: str = ""
    enabled: bool = True
    healthy: bool = True
    cooldown_until: float = 0.0
    requests: int = 0
    failures: int = 0
    quota: dict = field(default_factory=dict)
    last_error: str = ""
    disabled_reason: str = ""
    source: str = "manual"
    created: float = 0.0
    last_used: float = 0.0
    caps: dict = field(default_factory=dict)     # model_alias -> direct|fallback|error
    _client: Optional[civision.CivisionClient] = field(default=None, repr=False, compare=False)

    @property
    def in_cooldown(self) -> bool:
        return time.time() < self.cooldown_until

    @property
    def available(self) -> bool:
        return self.enabled and self.healthy and not self.in_cooldown

    @property
    def cooldown_sec(self) -> int:
        return max(0, int(self.cooldown_until - time.time()))

    def client(self) -> civision.CivisionClient:
        if self._client is None:
            self._client = civision.CivisionClient(civision.ClientOptions(
                cookie=self.cookie, token=self.token, label=self.label))
        return self._client

    def reset_client(self) -> None:
        if self._client is not None:
            self._client.close()
            self._client = None

    def view(self) -> dict:
        return {
            "id": self.id, "label": self.label, "email": self.email,
            "enabled": self.enabled, "healthy": self.healthy,
            "cooldown_sec": self.cooldown_sec, "requests": self.requests,
            "failures": self.failures, "quota": self.quota, "last_error": self.last_error,
            "disabled_reason": self.disabled_reason, "source": self.source,
            "created": self.created, "last_used": self.last_used,
            "has_cookie": bool(self.cookie), "has_token": bool(self.token),
            "cookie_tail": self.cookie[-12:] if self.cookie else "",
            "caps": self.caps,
        }


# ------------------------------------------------------------------ 行映射
def _row_to_account(r: Any) -> Account:
    return Account(
        id=r["id"], label=r["label"], email=r["email"], cookie=r["cookie"], token=r["token"],
        password=r["password"], enabled=bool(r["enabled"]), healthy=bool(r["healthy"]),
        cooldown_until=r["cooldown_until"], requests=r["requests"], failures=r["failures"],
        quota=store.jload(r["quota"], {}), last_error=r["last_error"],
        disabled_reason=r["disabled_reason"], source=r["source"], created=r["created"],
        last_used=r["last_used"],
    )


def _save(a: Account) -> None:
    store.execute(
        "UPDATE accounts SET label=?,email=?,cookie=?,token=?,password=?,enabled=?,healthy=?,"
        "cooldown_until=?,requests=?,failures=?,quota=?,last_error=?,disabled_reason=?,"
        "source=?,last_used=? WHERE id=?",
        (a.label, a.email, a.cookie, a.token, a.password, 1 if a.enabled else 0,
         1 if a.healthy else 0, a.cooldown_until, a.requests, a.failures,
         store.jdump(a.quota), a.last_error, a.disabled_reason, a.source, a.last_used, a.id))


# ------------------------------------------------------------------ 号池
class AccountPool:
    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._rr = 0

    # -------------------------------------------------- 读
    def all(self) -> list[Account]:
        return [_row_to_account(r) for r in
                store.q("SELECT * FROM accounts ORDER BY created ASC")]

    def get(self, acc_id: str) -> Optional[Account]:
        r = store.q1("SELECT * FROM accounts WHERE id=?", (acc_id,))
        return _row_to_account(r) if r else None

    def count(self) -> dict:
        rows = self.all()
        return {
            "total": len(rows),
            "enabled": sum(1 for a in rows if a.enabled),
            "healthy": sum(1 for a in rows if a.healthy),
            "cooldown": sum(1 for a in rows if a.in_cooldown),
            "available": sum(1 for a in rows if a.available),
        }

    # -------------------------------------------------- 写
    def add_account(self, *, cookie: str = "", token: str = "", label: str = "",
                    email: str = "", password: str = "", source: str = "manual") -> dict:
        if not cookie and not token:
            raise ValueError("必须提供 cookie 或 token")
        now = time.time()
        acc_id = "acc_" + secrets.token_hex(6)
        store.execute(
            "INSERT INTO accounts (id,label,email,cookie,token,password,enabled,healthy,"
            "cooldown_until,requests,failures,quota,last_error,disabled_reason,source,created,"
            "last_used) VALUES (?,?,?,?,?,?,1,1,0,0,0,'{}','','',?,?,0)",
            (acc_id, label or email or acc_id[:12], email, cookie, token, password, source, now))
        store.log("info", "pool", f"新增账号 {label or email or acc_id}（{source}）", id=acc_id)
        return (self.get(acc_id) or Account(id=acc_id)).view()

    def import_many(self, text: str, label: str = "批量导入") -> list[dict]:
        out = []
        for i, line in enumerate((text or "").splitlines()):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if "=" in line and ";" not in line.split("=")[0] and line.lower().startswith(("cookie=", "token=")):
                k, v = line.split("=", 1)
                kw = {k.strip().lower(): v.strip()}
                out.append(self.add_account(label=f"{label}-{i + 1}", source="import", **kw))
            elif line.count("=") and line.count(";") >= 1:
                out.append(self.add_account(cookie=line, label=f"{label}-{i + 1}", source="import"))
            elif len(line) > 20:
                out.append(self.add_account(cookie=line, label=f"{label}-{i + 1}", source="import"))
        return out

    def remove(self, acc_id: str) -> bool:
        a = self.get(acc_id)
        if a:
            a.reset_client()
        store.execute("DELETE FROM accounts WHERE id=?", (acc_id,))
        store.log("info", "pool", f"删除账号 {acc_id}")
        return True

    def set_enabled(self, acc_id: str, enabled: bool) -> Optional[dict]:
        a = self.get(acc_id)
        if not a:
            return None
        a.enabled = enabled
        if enabled:
            a.healthy = True
            a.disabled_reason = ""
            a.cooldown_until = 0
        _save(a)
        return a.view()

    def patch(self, acc_id: str, patch: dict) -> Optional[dict]:
        a = self.get(acc_id)
        if not a:
            return None
        for k in ("label", "email", "cookie", "token", "password"):
            if patch.get(k) is not None:
                setattr(a, k, str(patch[k]))
        a.reset_client()
        _save(a)
        return a.view()

    # -------------------------------------------------- 选号
    def acquire(self, kind: str = "", model: str = "",
                exclude: Optional[set] = None) -> Optional[Account]:
        exclude = exclude or set()
        with self._lock:
            cands = [a for a in self.all() if a.available and a.id not in exclude]
            if not cands:
                return None

            def score(a: Account) -> int:
                cap = a.caps.get(model) if model else None
                if cap == "direct":
                    return 3
                if cap == "error":
                    return 0
                if cap == "fallback":
                    return 1
                return 2

            best = max(score(a) for a in cands)
            pool = [a for a in cands if score(a) == best]
            pool.sort(key=lambda a: (a.last_used, a.requests))
            self._rr = (self._rr + 1) % len(pool)
            return pool[self._rr]

    # -------------------------------------------------- 反馈
    def report(self, acc: Account, *, model: str = "", ok: bool = False, error: str = "",
               kind_hint: str = "") -> None:
        acc.requests += 1
        acc.last_used = time.time()
        if ok:
            if model:
                acc.caps[model] = "direct"
            _save(acc)
            return
        acc.failures += 1
        acc.last_error = (error or "")[:300]
        e = (error or "").lower()
        if kind_hint == "auth" or "401" in e or "not logged in" in e or "access forbidden" in e:
            acc.healthy = False
            acc.disabled_reason = "登录态失效：" + (error or "")[:120]
            if model:
                acc.caps[model] = "error"
        elif kind_hint == "quota" or "quota" in e or "insufficient" in e or "balance" in e:
            acc.cooldown_until = time.time() + 3600
            if model:
                acc.caps[model] = "error"
        elif kind_hint == "rate" or "429" in e or "frequent" in e:
            acc.cooldown_until = time.time() + config.SETTINGS.cooldown
            if model:
                acc.caps[model] = "error"
        else:
            acc.cooldown_until = time.time() + config.SETTINGS.cooldown
            if model:
                acc.caps[model] = "error"
        _save(acc)

    # -------------------------------------------------- 健康检查
    def check(self, acc_id: str) -> dict:
        a = self.get(acc_id)
        if not a:
            raise KeyError(acc_id)
        a.reset_client()
        try:
            h = a.client().health()
        except Exception as e:
            h = {"healthy": False, "error": str(e)[:300]}
        a.healthy = bool(h.get("healthy"))
        a.quota = h.get("quota") or {}
        if not a.healthy:
            a.disabled_reason = str(h.get("error") or "")[:200]
        else:
            a.disabled_reason = ""
        if h.get("email"):
            a.email = a.email or h["email"]
            a.label = a.label or h["email"]
        _save(a)
        return {"id": acc_id, **h, "view": a.view()}

    def check_all(self) -> list[dict]:
        out = []
        for a in self.all():
            try:
                out.append(self.check(a.id))
            except Exception as e:
                out.append({"id": a.id, "healthy": False, "error": str(e)})
        return out

    # -------------------------------------------------- 自动补号
    def ensure_size(self, size: int = 0, *, provider: str = "", verify: bool = True) -> dict:
        size = size or config.SETTINGS.pool_size
        cur = self.count()
        need = size - cur["healthy"]
        if need <= 0:
            return {"added": 0, "needed": 0, "status": "ok", "count": cur}
        import provision
        job = provision.start_refill(need, provider, verify=verify)
        store.log("info", "pool", f"触发自动补号 {need} 个（job {job.id}）")
        return {"added": 0, "needed": need, "status": "started", "job": job.id, "count": cur}

    # -------------------------------------------------- 生成（带故障转移）
    def generate(self, kind: str, body_factory: Callable[[Account], dict], *,
                 model: str = "", timeout: float | None = None,
                 on_progress: Callable[[dict], None] | None = None) -> dict:
        attempts: list[dict] = []
        exclude: set[str] = set()
        last_err: Optional[Exception] = None

        for _ in range(max(1, config.SETTINGS.max_attempts)):
            acc = self.acquire(kind, model, exclude)
            if acc is None:
                break
            exclude.add(acc.id)
            t0 = time.time()
            try:
                body = body_factory(acc)
                res = acc.client().generate(kind, body, timeout=timeout, on_progress=on_progress)
            except civision.UpstreamError as e:
                last_err = e
                self.report(acc, model=model, ok=False, error=str(e), kind_hint=e.kind)
                attempts.append({"account": acc.label, "error": str(e)[:200], "kind": e.kind})
                if e.kind == "param":
                    raise
                continue
            except Exception as e:
                last_err = e
                self.report(acc, model=model, ok=False, error=str(e))
                attempts.append({"account": acc.label, "error": str(e)[:200]})
                continue

            status = res.get("status")
            if status == "succeeded":
                self.report(acc, model=model, ok=True)
                res["account"] = acc.label
                res["account_id"] = acc.id
                res["attempts"] = attempts
                return res
            if status == "failed":
                err = res.get("error") or "上游返回失败"
                self.report(acc, model=model, ok=False, error=err)
                attempts.append({"account": acc.label, "error": err[:200], "kind": "upstream"})
                continue
            # timeout / processing
            res["account"] = acc.label
            res["account_id"] = acc.id
            res["attempts"] = attempts
            return res

        if last_err is not None and not attempts:
            raise last_err
        if not attempts:
            raise PoolExhausted("号池无可用账号（请先添加账号或执行一键补号）")
        raise PoolExhausted("所有账号均失败：" + "; ".join(a.get("error", "") for a in attempts[:3]))


POOL = AccountPool()
