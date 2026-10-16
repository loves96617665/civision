"""provision.py — 一键注册补号（邮箱源 -> 激活邮件 -> 会话）。

链路（逆向自 index-7NIgzoXo.js）：
  1. POST /api/v1/auth/check        {email, user_name}          校验可用性
  2. POST /api/v1/auth/sendEmail    {email, password: RSA, from_site, captcha_verify}
  3. 收激活邮件 -> 抽出确认链接 -> GET 链接
  4. POST /api/v1/auth/loginRegister {email, user_name, password: RSA, from_site, callback_url}
  5. 从响应 Set-Cookie 抽出会话

验证码：阿里云验证码 2.0（SceneId 49006ysb）。命中 code 11 时进入 waiting_captcha，
由 WebUI 人工过码后回填 captcha_verify 继续。
"""
from __future__ import annotations

import json
import random
import re
import secrets
import string
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import httpx

import config
import crypto
import mailbox as mailbox_mod
import store

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")

STAGES = ["mailbox", "check", "sendEmail", "captcha", "confirm", "loginRegister", "done"]

CAPTCHA_HINTS = ("captcha", "verify code", "verification code", "验证码", "滑块", "人机")


def is_captcha_error(data: Any) -> bool:
    """上游对验证码缺失的两种表达：code 11，或 message 里带 captcha 字样。"""
    if not isinstance(data, dict):
        return False
    if data.get("code") == 11:
        return True
    blob = " ".join(str(data.get(k) or "") for k in
                    ("msg", "message", "Message", "error", "error_message", "data")).lower()
    return any(h in blob for h in CAPTCHA_HINTS)


def normalize_captcha(value: Any) -> str:
    """容错：用户可能连 `captcha_verify=` 前缀、引号或整段 JSON 一起粘进来。"""
    s = str(value or "").strip()
    if not s:
        return ""
    # 整段 JSON: {"captcha_verify":"..."}
    m = re.search(r'"(?:captcha_verify|captchaVerify|captchaToken)"\s*:\s*"([^"]+)"', s)
    if m:
        return m.group(1).strip()
    # 带前缀: captcha_verify=xxx
    m = re.match(r"^\s*(?:captcha_verify|captchaVerify|captcha)\s*[=:]\s*(.+)$", s, re.I)
    if m:
        s = m.group(1).strip()
    # 去掉包裹的引号
    if len(s) >= 2 and s[0] == s[-1] and s[0] in "\"'":
        s = s[1:-1].strip()
    return s


# ------------------------------------------------------------------ 工具
def gen_username(prefix: str = "") -> str:
    p = prefix or config.SETTINGS.register_user_prefix
    tail = "".join(random.choices(string.ascii_lowercase + string.digits, k=7))
    return f"{p}{tail}"


def gen_password(length: int = 0) -> str:
    """生成满足前端强度规则的密码（≥8，含数字/字母/大写或符号）。"""
    n = length or config.SETTINGS.register_password_len
    n = max(12, n)
    pools = [string.ascii_lowercase, string.ascii_uppercase, string.digits, "!@#$%^&*"]
    chars = [random.choice(p) for p in pools]
    chars += [random.choice(string.ascii_letters + string.digits) for _ in range(n - len(chars))]
    random.shuffle(chars)
    return "".join(chars)


def _session_headers(cookie: str = "") -> dict:
    h = {
        "User-Agent": UA,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": config.SETTINGS.accept_language,
        "Content-Type": "application/json",
        "bx-v": config.SETTINGS.bx_v,
        "X-ModelScope-Accept-Language": config.SETTINGS.accept_language,
        "X-ModelScope-Trace-Id": uuid.uuid4().hex,
    }
    if cookie:
        h["Cookie"] = cookie
    return h


def cookie_header(jar: httpx.Cookies) -> str:
    parts = []
    for c in jar.jar:
        parts.append(f"{c.name}={c.value}")
    return "; ".join(parts)


# ------------------------------------------------------------------ 任务模型
@dataclass
class Step:
    stage: str
    message: str
    at: float = field(default_factory=time.time)

    def to_dict(self) -> dict:
        return {"stage": self.stage, "message": self.message, "at": self.at}


@dataclass
class RegisterJob:
    id: str
    provider: str
    target: int = 1
    status: str = "pending"          # pending|running|waiting_captcha|done|failed
    steps: list[Step] = field(default_factory=list)
    created: float = field(default_factory=time.time)
    updated: float = field(default_factory=time.time)
    done: int = 0
    failed: int = 0
    accounts: list[dict] = field(default_factory=list)
    need_captcha: dict = field(default_factory=dict)
    error: str = ""

    # 人工过码同步原语
    _event: threading.Event = field(default_factory=threading.Event, repr=False)
    _captcha_value: str = ""
    _lock: threading.RLock = field(default_factory=threading.RLock, repr=False)

    def add(self, stage: str, message: str) -> None:
        with self._lock:
            self.steps.append(Step(stage, message))
            self.updated = time.time()

    def supply_captcha(self, value: str) -> bool:
        with self._lock:
            self._captcha_value = normalize_captcha(value)
            self.need_captcha = {}
            self.status = "running"
        self._event.set()
        return True

    def wait_captcha(self, payload: dict, timeout: float = 600.0) -> str:
        with self._lock:
            self.need_captcha = payload
            self.status = "waiting_captcha"
            self._captcha_value = ""
        self._event.clear()
        self.add("captcha", "等待人工完成阿里云验证码（在管理台粘贴 captcha_verify）")
        got = self._event.wait(timeout)
        with self._lock:
            val = self._captcha_value
            self.need_captcha = {}
            self.status = "running"
        if not got:
            self.add("captcha", "验证码等待超时（600s）")
            return ""
        self.add("captcha", f"已收到 captcha_verify（{len(val)} 字符）")
        return val

    def to_dict(self) -> dict:
        with self._lock:
            return {
                "job": self.id,
                "provider": self.provider,
                "status": self.status,
                "target": self.target,
                "done": self.done,
                "failed": self.failed,
                "created": self.created,
                "updated": self.updated,
                "steps": [s.to_dict() for s in self.steps],
                "accounts": self.accounts,
                "need_captcha": self.need_captcha,
                "error": self.error,
            }


JOBS: dict[str, RegisterJob] = {}
JOBS_LOCK = threading.RLock()


def get_job(job_id: str) -> Optional[RegisterJob]:
    with JOBS_LOCK:
        return JOBS.get(job_id)


def _persist(job: RegisterJob) -> None:
    try:
        store.execute(
            "INSERT INTO jobs (id,kind,status,payload,steps,created,updated) VALUES (?,?,?,?,?,?,?) "
            "ON CONFLICT(id) DO UPDATE SET status=excluded.status,steps=excluded.steps,"
            "payload=excluded.payload,updated=excluded.updated",
            (job.id, "refill", job.status, store.jdump({"provider": job.provider,
                                                        "target": job.target,
                                                        "done": job.done,
                                                        "failed": job.failed,
                                                        "error": job.error}),
             store.jdump([s.to_dict() for s in job.steps]), job.created, job.updated))
    except Exception:
        pass


# ------------------------------------------------------------------ 单账号注册
@dataclass
class ProvisionResult:
    ok: bool
    email: str = ""
    username: str = ""
    password: str = ""
    cookie: str = ""
    stage: str = ""
    error: str = ""
    need_captcha: bool = False
    mailbox: dict = field(default_factory=dict)
    upstream: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {
            "ok": self.ok, "email": self.email, "username": self.username,
            "password": self.password, "stage": self.stage, "error": self.error,
            "need_captcha": self.need_captcha, "mailbox": self.mailbox,
        }


class Provisioner:
    def __init__(self, job: Optional[RegisterJob] = None, *, verify: bool = True,
                 captcha_verify: str = ""):
        self.job = job
        self.verify = verify
        self.captcha_verify = captcha_verify
        self.base = config.SETTINGS.upstream_base.rstrip("/")
        self.client = httpx.Client(
            headers=_session_headers(),
            timeout=httpx.Timeout(60.0, connect=20.0),
            follow_redirects=True,
            proxy=config.SETTINGS.proxy or None,
        )

    def log(self, stage: str, msg: str, level: str = "info") -> None:
        if self.job:
            self.job.add(stage, msg)
        store.log(level, "provision", msg, stage=stage, job=self.job.id if self.job else "")

    def close(self) -> None:
        try:
            self.client.close()
        except Exception:
            pass

    # -------------------------------------------------- 上游调用
    def _post(self, path: str, body: dict) -> tuple[int, Any]:
        r = self.client.post(self.base + "/api" + path, json=body)
        try:
            return r.status_code, r.json()
        except Exception:
            return r.status_code, {"_raw": r.text[:500]}

    def auth_check(self, email: str, user_name: str) -> dict:
        _, data = self._post("/v1/auth/check", {"email": email, "user_name": user_name})
        return data if isinstance(data, dict) else {}

    def send_email(self, email: str, password: str, captcha: str) -> dict:
        body = {
            "email": email,
            "password": crypto.encrypt_password(password),
            "from_site": config.SETTINGS.from_site,
            "captcha_verify": captcha or "",
        }
        _, data = self._post("/v1/auth/sendEmail", body)
        return data if isinstance(data, dict) else {}

    def login_register(self, email: str, user_name: str, password: str, callback: str,
                       captcha: str = "") -> dict:
        body = {
            "email": email,
            "user_name": user_name,
            "password": crypto.encrypt_password(password),
            "from_site": config.SETTINGS.from_site,
            "callback_url": callback,
        }
        if captcha:
            body["captcha_verify"] = captcha
        _, data = self._post("/v1/auth/loginRegister", body)
        return data if isinstance(data, dict) else {}

    def visit(self, url: str) -> int:
        try:
            r = self.client.get(url)
            return r.status_code
        except Exception as e:
            self.log("confirm", f"访问确认链接失败: {e}", "warn")
            return 0

    # -------------------------------------------------- 主流程
    def run(self, provider_name: str = "", mail_kw: dict | None = None) -> ProvisionResult:
        provider_name = mailbox_mod.normalize_name(provider_name) or config.SETTINGS.mail_provider
        res = ProvisionResult(ok=False)
        try:
            prov = mailbox_mod.get_provider(provider_name, **(mail_kw or {}))
        except Exception as e:
            res.error = f"邮箱源初始化失败: {e}"
            self.log("mailbox", res.error, "error")
            return res

        # 1) 邮箱
        self.log("mailbox", f"使用邮箱源 {provider_name}")
        try:
            box = prov.create()
        except Exception as e:
            res.error = f"创建邮箱失败: {e}"
            self.log("mailbox", res.error, "error")
            return res
        res.email = box.address
        res.mailbox = box.to_dict()
        self.log("mailbox", f"新地址 {box.address}")

        username = gen_username()
        password = gen_password()
        res.username, res.password = username, password

        # 2) 可用性校验
        try:
            chk = self.auth_check(box.address, username)
            self.log("check", f"auth/check -> {json.dumps(chk, ensure_ascii=False)[:200]}")
            if chk.get("success") is False:
                res.error = str(chk.get("msg") or chk.get("message") or "邮箱/用户名不可用")
                self.log("check", res.error, "warn")
                return res
        except Exception as e:
            self.log("check", f"auth/check 异常（继续）: {e}", "warn")

        # 3) 发激活邮件（验证码可能在这里拦）
        captcha = self.captcha_verify
        for attempt in range(3):
            try:
                data = self.send_email(box.address, password, captcha)
            except Exception as e:
                res.error = f"sendEmail 异常: {e}"
                self.log("sendEmail", res.error, "error")
                return res
            code = data.get("code")
            self.log("sendEmail", f"code={code} success={data.get('success')} "
                                  f"msg={data.get('msg') or data.get('message') or ''}")
            if is_captcha_error(data):
                res.need_captcha = True
                res.stage = "captcha"
                if self.job:
                    captcha = self.job.wait_captcha({
                        "email": box.address,
                        "scene_id": config.SETTINGS.captcha_scene_id,
                        "prefix_cn": config.SETTINGS.captcha_prefix_cn,
                        "prefix_intl": config.SETTINGS.captcha_prefix_intl,
                        "reason": str(data.get("msg") or data.get("message")
                                      or "上游要求阿里云验证码"),
                    })
                    if not captcha:
                        res.error = "未取得 captcha_verify"
                        return res
                    continue
                res.error = (str(data.get("msg") or data.get("message")
                                 or "上游要求验证码") + "（请在管理台过码后重试）")
                return res
            if code == 12:
                self.log("sendEmail", f"上游告警: {data.get('msg') or ''}", "warn")
            if data.get("success") or code in (0, 200, 12):
                break
            res.error = str(data.get("msg") or data.get("message") or f"sendEmail 失败 code={code}")
            if attempt == 2:
                return res
            time.sleep(2)

        # 4) 等激活邮件
        if self.verify:
            self.log("confirm", f"等待激活邮件（≤{int(config.SETTINGS.mail_timeout)}s）")
            msg = prov.wait_for_activation(box, timeout=config.SETTINGS.mail_timeout)
            if not msg:
                res.error = "未收到激活邮件（邮箱源可能被上游拒收）"
                res.stage = "confirm"
                self.log("confirm", res.error, "error")
                return res
            link = msg.get("confirm_link") or ""
            self.log("confirm", f"收到邮件「{msg.get('subject', '')[:80]}」链接={link[:120]}")
            if link:
                sc = self.visit(link)
                self.log("confirm", f"确认链接 -> HTTP {sc}")
        else:
            self.log("confirm", "跳过邮件确认（verify=false）")

        # 5) 完成注册
        callback = f"{self.base}/login"
        try:
            reg = self.login_register(box.address, username, password, callback, captcha)
        except Exception as e:
            res.error = f"loginRegister 异常: {e}"
            self.log("loginRegister", res.error, "error")
            return res
        code = reg.get("code")
        self.log("loginRegister", f"code={code} success={reg.get('success')} "
                                  f"msg={reg.get('msg') or reg.get('message') or ''}")
        if is_captcha_error(reg) and self.job and not captcha:
            captcha = self.job.wait_captcha({"email": box.address,
                                             "scene_id": config.SETTINGS.captcha_scene_id,
                                             "reason": "loginRegister 要求验证码"})
            if captcha:
                reg = self.login_register(box.address, username, password, callback, captcha)
                code = reg.get("code")
                self.log("loginRegister", f"重试 code={code} success={reg.get('success')}")

        if reg.get("success") is False and code not in (0, 200, 12):
            res.error = str(reg.get("msg") or reg.get("message") or f"注册失败 code={code}")
            res.stage = "loginRegister"
            return res

        # 6) 抽会话
        cookie = cookie_header(self.client.cookies)
        if not cookie:
            try:
                li = self.client.get(self.base + "/api/v1/users/login/info")
                cookie = cookie_header(self.client.cookies)
                if li.status_code == 200:
                    self.log("loginRegister", "登录态已建立（login/info 200）")
                else:
                    self.log("loginRegister", f"login/info -> {li.status_code}（可能需要邮箱点确认）",
                             "warn")
            except Exception:
                pass

        res.cookie = cookie
        res.ok = True
        res.stage = "done"
        res.upstream = reg
        self.log("done", f"注册完成 {box.address}（cookie {len(cookie)} 字符）")
        return res


# ------------------------------------------------------------------ 任务驱动
def start_refill(count: int = 1, provider: str = "", *, verify: bool = True,
                 captcha_verify: str = "", mail_kw: dict | None = None) -> RegisterJob:
    # 前端可能传来 "" / "undefined" / "null" 这类假值字面量，统一归一后回退到默认源
    wanted = mailbox_mod.normalize_name(provider)
    chosen = wanted or config.SETTINGS.mail_provider
    if wanted and mailbox_mod.normalize_name(wanted) not in mailbox_mod.PROVIDERS:
        store.log("warn", "provision",
                  f"收到未知邮箱源 {provider!r}，回退到 {chosen}", provider=provider)

    job = RegisterJob(id="job_" + secrets.token_hex(6), provider=chosen,
                      target=max(1, int(count)))
    with JOBS_LOCK:
        JOBS[job.id] = job

    def worker() -> None:
        job.status = "running"
        _persist(job)
        for i in range(job.target):
            job.add("mailbox", f"=== 第 {i + 1}/{job.target} 个账号 ===")
            p = Provisioner(job, verify=verify, captcha_verify=captcha_verify)
            try:
                # 用 job.provider（已归一/回退），不要用原始入参
                r = p.run(job.provider, mail_kw)
            except Exception as e:
                r = ProvisionResult(ok=False, error=f"未捕获异常: {e}")
            finally:
                p.close()
            if r.ok:
                acc = add_account_from_provision(r)
                job.done += 1
                job.accounts.append(acc)
                job.add("done", f"账号入库 {r.email}")
            else:
                job.failed += 1
                job.add("failed", f"失败 {r.email or '-'}: {r.error}")
            _persist(job)
        job.status = "done" if job.failed == 0 else ("done" if job.done else "failed")
        job.error = "" if job.done else (job.steps[-1].message if job.steps else "")
        job.updated = time.time()
        _persist(job)
        store.log("info", "provision", f"补号任务 {job.id} 结束: 成功 {job.done}/{job.target}",
                  job=job.id, provider=job.provider)

    t = threading.Thread(target=worker, name=f"refill-{job.id}", daemon=True)
    t.start()
    return job


def add_account_from_provision(r: ProvisionResult, *, label: str = "") -> dict:
    """把注册结果写进号池表，返回账号视图。"""
    import pool
    return pool.add_account(cookie=r.cookie, label=label or r.email, email=r.email,
                            password=r.password, source="provision")


if __name__ == "__main__":
    import sys
    prov_name = sys.argv[1] if len(sys.argv) > 1 else "emailnator"
    verify = "--no-verify" not in sys.argv
    p = Provisioner(verify=verify)
    out = p.run(prov_name)
    p.close()
    print(json.dumps(out.to_dict(), ensure_ascii=False, indent=2))
