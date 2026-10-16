"""mailbox.py — 临时邮箱源适配层（一键注册补号用）。

已逆向的源：
  * emailnator.com      —— 完整 REST（/api/generate-email, /api/message-list, /api/message/{id}）
  * boomlify.com        —— 游客通道（/domains/public, /guest/init, /guest/emails/create,
                           /emails/public/{addr}），限流后要求 Cloudflare Turnstile
  * temp.tf             —— Next.js 前端，POST /api/check 校验地址（限流/风控严格）
  * relay.firefox.com   —— 邮件掩码服务，不是临时箱：走 IMAP 轮询转发到的真实邮箱

统一接口：create() -> Mailbox / messages() / message() / wait_for()
"""
from __future__ import annotations

import email
import email.policy
import imaplib
import json
import random
import re
import string
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import requests

import store

UA = ("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0")

LINK_RE = re.compile(r"https?://[^\s\"'<>)\]]+")
CODE_RE = re.compile(r"\b(\d{4,8})\b")


class MailboxError(RuntimeError):
    pass


@dataclass
class Address:
    address: str
    provider: str
    box_id: str = ""
    meta: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return {"address": self.address, "provider": self.provider,
                "box_id": self.box_id, "meta": self.meta}


def _rand(n: int = 10) -> str:
    return "".join(random.choices(string.ascii_lowercase + string.digits, k=n))


def _decode_msg(raw: str) -> dict:
    """把原始邮件文本解析成 {subject, from, text, html, links}。"""
    try:
        msg = email.message_from_string(raw, policy=email.policy.default)
    except Exception:
        return {"subject": "", "from": "", "text": raw[:20000], "html": "",
                "links": LINK_RE.findall(raw)}
    text_parts, html_parts = [], []
    if msg.is_multipart():
        for part in msg.walk():
            ct = part.get_content_type()
            try:
                body = part.get_content()
            except Exception:
                continue
            if not isinstance(body, str):
                continue
            if ct == "text/plain":
                text_parts.append(body)
            elif ct == "text/html":
                html_parts.append(body)
    else:
        try:
            body = msg.get_content()
            (html_parts if msg.get_content_type() == "text/html" else text_parts).append(
                body if isinstance(body, str) else "")
        except Exception:
            pass
    text = "\n".join(text_parts)
    html = "\n".join(html_parts)
    links = LINK_RE.findall(text) + LINK_RE.findall(html)
    return {
        "subject": str(msg.get("subject") or ""),
        "from": str(msg.get("from") or ""),
        "to": str(msg.get("to") or ""),
        "date": str(msg.get("date") or ""),
        "text": text[:60000],
        "html": html[:200000],
        "links": [l for l in links if "unsubscribe" not in l.lower()],
    }


# ==================================================================== 基类
class MailProvider:
    name = "base"
    label = "base"
    needs_captcha = False
    captcha_site_key = ""

    def __init__(self, timeout: float = 30.0):
        self.timeout = timeout
        self.http = requests.Session()
        self.http.headers.update({"User-Agent": UA, "Accept": "application/json, text/plain, */*",
                                  "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"})

    # ---- 必须实现
    def create(self) -> Address:
        raise NotImplementedError

    def messages(self, box: Address) -> list[dict]:
        raise NotImplementedError

    def message(self, box: Address, msg_id: str) -> dict:
        raise NotImplementedError

    # ---- 通用
    def wait_for(self, box: Address, match: Callable[[dict], bool],
                 timeout: float = 240.0, interval: float = 5.0) -> Optional[dict]:
        deadline = time.time() + timeout
        seen: set[str] = set()
        while time.time() < deadline:
            try:
                for m in self.messages(box):
                    mid = str(m.get("id") or m.get("messageID") or "")
                    if not mid or mid in seen:
                        continue
                    seen.add(mid)
                    if match(m):
                        try:
                            full = self.message(box, mid)
                        except Exception:
                            full = dict(m)
                        full.setdefault("id", mid)
                        return full
            except MailboxError as e:
                store.log("warn", f"mail:{self.name}", f"轮询收件箱失败: {e}")
            time.sleep(interval)
        return None

    def wait_for_activation(self, box: Address, *, sender_hint: str = "modelscope",
                            subject_hint: str = "", timeout: float = 240.0) -> Optional[dict]:
        """等激活邮件并抽出确认链接 / 验证码。"""
        def match(m: dict) -> bool:
            blob = json.dumps(m, ensure_ascii=False).lower()
            if sender_hint and sender_hint.lower() in blob:
                return True
            if subject_hint and subject_hint.lower() in blob:
                return True
            return "modelscope" in blob or "魔搭" in blob or "verify" in blob or "confirm" in blob

        msg = self.wait_for(box, match, timeout=timeout)
        if not msg:
            return None
        links = msg.get("links") or LINK_RE.findall(json.dumps(msg, ensure_ascii=False))
        confirm = ""
        for l in links:
            low = l.lower()
            if any(k in low for k in ("confirm", "verify", "activate", "activation", "token",
                                      "callback", "register")):
                confirm = l
                break
        if not confirm and links:
            confirm = links[0]
        codes = CODE_RE.findall(msg.get("text") or "")
        msg["confirm_link"] = confirm
        msg["code"] = codes[0] if codes else ""
        return msg


# ==================================================================== emailnator
class EmailnatorProvider(MailProvider):
    """emailnator.com —— 真实 @gmail.com 地址（ids=[8] googleMail）。"""
    name = "emailnator"
    label = "Emailnator (Gmail)"
    ORIGIN = "https://www.emailnator.com"
    EMAIL_TYPES = {"domain": 1, "plusGmail": 2, "dotGmail": 3, "googleMail": 8}

    def __init__(self, timeout: float = 30.0):
        super().__init__(timeout)
        self.http.headers.update({"Origin": self.ORIGIN, "Referer": self.ORIGIN + "/",
                                  "Content-Type": "application/json"})

    def _post(self, path: str, payload: dict) -> Any:
        r = self.http.post(self.ORIGIN + path, json=payload, timeout=self.timeout)
        try:
            data = r.json()
        except Exception:
            raise MailboxError(f"{path} -> HTTP {r.status_code}: {r.text[:200]}")
        if r.status_code != 200 or (isinstance(data, dict) and data.get("status") not in (None, "success")):
            raise MailboxError(f"{path} -> {json.dumps(data, ensure_ascii=False)[:300]}")
        return data

    def _get(self, path: str) -> Any:
        r = self.http.get(self.ORIGIN + path, timeout=self.timeout)
        return r.json()

    def create(self) -> Address:
        data = self._post("/api/generate-email", {"ids": [self.EMAIL_TYPES["googleMail"]]})
        addr = data.get("email")
        if not addr:
            raise MailboxError(f"generate-email 无 email: {data}")
        return Address(address=addr, provider=self.name, box_id=addr,
                       meta={"email_type_id": data.get("email_type_id", 8)})

    def extend(self, box: Address) -> dict:
        return self._post("/api/extend-email", {"email": box.address})

    def messages(self, box: Address) -> list[dict]:
        data = self._post("/api/message-list", {"email": box.address, "limit": 30})
        if isinstance(data, list):
            return data
        return data.get("messageData") or data.get("messages") or []

    def message(self, box: Address, msg_id: str) -> dict:
        raw = self._get(f"/api/message/{msg_id}")
        out = dict(raw) if isinstance(raw, dict) else {"data": raw}
        body = json.dumps(raw, ensure_ascii=False)
        out.setdefault("id", msg_id)
        out.setdefault("links", LINK_RE.findall(body))
        txt = out.get("text") or out.get("body") or ""
        if isinstance(txt, str) and "<" in txt:
            out.setdefault("html", txt)
        return out


# ==================================================================== boomlify
class BoomlifyProvider(MailProvider):
    """boomlify.com 游客通道。

    逆向结果：
      GET  /domains/public            -> [{id, domain, is_active, ...}]
      POST /guest/init                -> 游客会话（返回 username 等）
      POST /guest/emails/create       -> 创建游客邮箱（body: {domainId})
      POST /emails/public/create      -> 同上（旧路径）
      GET  /emails/public/{address}   -> 邮件列表
    限流时返回 {"error":"CAPTCHA_REQUIRED","captchaSiteKey":"0x..."}（Cloudflare Turnstile）
    """
    name = "boomlify"
    label = "Boomlify"
    needs_captcha = True
    BASE = "https://v1.boomlify.com"

    def __init__(self, timeout: float = 30.0, turnstile_token: str = ""):
        super().__init__(timeout)
        self.http.headers.update({"Origin": "https://boomlify.com",
                                  "Referer": "https://boomlify.com/zh/",
                                  "Content-Type": "application/json"})
        self.turnstile = turnstile_token
        self._domains: list[dict] = []

    def _req(self, method: str, path: str, **kw) -> Any:
        if self.turnstile:
            kw.setdefault("headers", {})["cf-turnstile-response"] = self.turnstile
        r = self.http.request(method, self.BASE + path, timeout=self.timeout, **kw)
        try:
            data = r.json()
        except Exception:
            data = {"_raw": r.text[:400]}
        if r.status_code >= 400 or (isinstance(data, dict) and data.get("error")):
            err = data.get("error") if isinstance(data, dict) else r.text[:200]
            if isinstance(data, dict) and data.get("captchaRequired"):
                self.captcha_site_key = data.get("captchaSiteKey", "")
                raise MailboxError(f"CAPTCHA_REQUIRED siteKey={self.captcha_site_key}")
            raise MailboxError(f"{path} -> {r.status_code} {err}")
        return data

    def domains(self, refresh: bool = False) -> list[dict]:
        if not self._domains or refresh:
            self._domains = self._req("GET", "/domains/public") or []
        return self._domains

    def create(self) -> Address:
        doms = self.domains(refresh=True)
        active = [d for d in doms if d.get("is_active")]
        if not active:
            raise MailboxError("boomlify 无可用公开域名")
        d = random.choice(active)
        # 先试游客会话，再退回公开创建
        guest: dict = {}
        try:
            guest = self._req("POST", "/guest/init", json={}) or {}
        except MailboxError:
            guest = {}
        username = (guest.get("username") or guest.get("data", {}).get("username") or "")
        payloads = [{"domainId": d["id"]}]
        if username:
            payloads.insert(0, {"domainId": d["id"], "name": username})
        last: Exception | None = None
        for p in payloads:
            for path in ("/guest/emails/create", "/emails/public/create"):
                try:
                    info = self._req("POST", path, json=p)
                    mid = info.get("id") or info.get("email_id") or ""
                    addr = (info.get("email") or info.get("address")
                            or f"{username or mid}@{d['domain']}")
                    if username and "@" not in addr:
                        addr = f"{username}@{d['domain']}"
                    return Address(address=addr, provider=self.name, box_id=mid,
                                   meta={"domain_id": d["id"], "domain": d["domain"],
                                         "guest": guest})
                except MailboxError as e:
                    last = e
        raise MailboxError(f"boomlify 创建邮箱失败: {last}")

    def messages(self, box: Address) -> list[dict]:
        data = self._req("GET", f"/emails/public/{box.address}")
        if isinstance(data, list):
            return data
        return data.get("emails") or data.get("data") or []

    def message(self, box: Address, msg_id: str) -> dict:
        for path in (f"/emails/public/{box.address}/{msg_id}",
                     f"/emails/public/message/{msg_id}"):
            try:
                data = self._req("GET", path)
                if isinstance(data, dict):
                    body = json.dumps(data, ensure_ascii=False)
                    data.setdefault("id", msg_id)
                    data.setdefault("links", LINK_RE.findall(body))
                    return data
            except MailboxError:
                continue
        return {"id": msg_id, "raw": ""}


# ==================================================================== temp.tf
class TempTfProvider(MailProvider):
    """temp.tf —— 前端 Next.js；可用端点：POST /api/check（校验地址）。

    该站对自动化风控严格（403 Forbidden / 需浏览器指纹），因此实现为
    "校验 + 浏览器兜底"：地址生成走本地随机 + 域名探测，收件依赖真实浏览器会话。
    """
    name = "temp.tf"
    label = "temp.tf"
    BASE = "https://temp.tf"
    FALLBACK_DOMAINS = ["swp.tf", "temp.tf"]

    def __init__(self, timeout: float = 30.0, cookie: str = ""):
        super().__init__(timeout)
        self.http.headers.update({"Origin": self.BASE, "Referer": self.BASE + "/",
                                  "Content-Type": "application/json"})
        if cookie:
            self.http.headers["Cookie"] = cookie

    def create(self) -> Address:
        local = _rand(11)
        domain = self.FALLBACK_DOMAINS[0]
        addr = f"{local}@{domain}"
        try:
            r = self.http.post(self.BASE + "/api/check", json={"email": addr}, timeout=self.timeout)
            if r.status_code == 403:
                store.log("warn", "mail:temp.tf",
                          "地址校验被风控拦截（403），收件需要浏览器会话或人工介入")
        except Exception as e:
            store.log("warn", "mail:temp.tf", f"check 失败: {e}")
        return Address(address=addr, provider=self.name, box_id=addr,
                       meta={"domain": domain, "needs_browser": True})

    def messages(self, box: Address) -> list[dict]:
        r = self.http.get(self.BASE + f"/api/inbox/{box.address}", timeout=self.timeout)
        if r.status_code >= 400:
            raise MailboxError(f"temp.tf inbox -> {r.status_code}")
        data = r.json()
        return data if isinstance(data, list) else data.get("messages") or []

    def message(self, box: Address, msg_id: str) -> dict:
        r = self.http.get(self.BASE + f"/api/message/{msg_id}", timeout=self.timeout)
        data = r.json()
        return data if isinstance(data, dict) else {"raw": data}


# ==================================================================== Firefox Relay
class RelayProvider(MailProvider):
    """relay.firefox.com —— 邮件掩码服务，把上游邮件转发到你的真实邮箱。

    不是临时箱：`create()` 返回配置好的掩码地址（人工在 Relay 后台生成后填入
    settings.relay_alias），收件走真实邮箱的 IMAP。
    """
    name = "relay.firefox.com"
    label = "Firefox Relay (IMAP 转发)"

    def __init__(self, timeout: float = 30.0, alias: str = "", imap_host: str = "",
                 imap_user: str = "", imap_pass: str = ""):
        super().__init__(timeout)
        self.alias = alias
        self.imap_host = imap_host
        self.imap_user = imap_user
        self.imap_pass = imap_pass

    def create(self) -> Address:
        if not self.alias:
            raise MailboxError(
                "Firefox Relay 需要在 relay.firefox.com 后台创建掩码地址，"
                "并把地址与 IMAP 参数写入设置（relay_alias / imap_*）")
        return Address(address=self.alias, provider=self.name, box_id=self.alias,
                       meta={"imap": self.imap_host, "mode": "forward"})

    def _imap(self) -> imaplib.IMAP4_SSL:
        if not (self.imap_host and self.imap_user and self.imap_pass):
            raise MailboxError("Relay 模式缺少 IMAP 配置")
        c = imaplib.IMAP4_SSL(self.imap_host)
        c.login(self.imap_user, self.imap_pass)
        return c

    def messages(self, box: Address) -> list[dict]:
        c = self._imap()
        try:
            c.select("INBOX")
            typ, data = c.search(None, f'(TO "{box.address}")')
            ids = (data[0] or b"").split()[-30:]
            out = []
            for i in reversed(ids):
                typ, raw = c.fetch(i, "(RFC822.HEADER)")
                if typ != "OK" or not raw or not raw[0]:
                    continue
                head = raw[0][1].decode("utf-8", "replace")
                parsed = _decode_msg(head)
                out.append({"id": i.decode(), "from": parsed["from"],
                            "subject": parsed["subject"], "date": parsed["date"],
                            "snippet": ""})
            return out
        finally:
            try:
                c.logout()
            except Exception:
                pass

    def message(self, box: Address, msg_id: str) -> dict:
        c = self._imap()
        try:
            c.select("INBOX")
            typ, raw = c.fetch(msg_id.encode(), "(RFC822)")
            if typ != "OK" or not raw or not raw[0]:
                raise MailboxError(f"读取邮件 {msg_id} 失败")
            parsed = _decode_msg(raw[0][1].decode("utf-8", "replace"))
            parsed["id"] = msg_id
            return parsed
        finally:
            try:
                c.logout()
            except Exception:
                pass


# ==================================================================== 注册表
PROVIDERS: dict[str, type[MailProvider]] = {
    EmailnatorProvider.name: EmailnatorProvider,
    BoomlifyProvider.name: BoomlifyProvider,
    TempTfProvider.name: TempTfProvider,
    RelayProvider.name: RelayProvider,
}

ALIASES = {
    "emailnator.com": "emailnator", "emailnator": "emailnator",
    "boomlify.com": "boomlify", "boomlify": "boomlify",
    "temp.tf": "temp.tf", "temptf": "temp.tf",
    "relay.firefox.com": "relay.firefox.com", "relay": "relay.firefox.com",
    "firefox-relay": "relay.firefox.com",
}


# 前端可能传进来的「假值」字面量（JS undefined/null 被字符串化后常见）
BOGUS_NAMES = {"", "undefined", "null", "none", "nil", "nan", "false"}


def normalize_name(name: str) -> str:
    """把各种假值归一成空串，交给调用方回退到默认源。"""
    if name is None:
        return ""
    s = str(name).strip()
    return "" if s.lower() in BOGUS_NAMES else s


def get_provider(name: str, **kw) -> MailProvider:
    key = normalize_name(name).lower()
    key = ALIASES.get(key, key)
    cls = PROVIDERS.get(key)
    if cls is None:
        raise MailboxError(
            f"未知邮箱源: {name!r}（可用: {', '.join(PROVIDERS)}）")
    return cls(**kw)


def provider_info() -> list[dict]:
    """管理台下拉用。

    同时给出 `id` 与 `name`：`id` 与其它 admin 列表接口保持一致，`name` 是 provider 的
    内部标识（= 传回 /admin/api/pool/refill 的 provider 值）。
    """
    return [
        {"id": "emailnator", "name": "emailnator", "label": "Emailnator (真实 Gmail)",
         "desc": "emailnator.com，可直接生成 @gmail.com 地址，收件 API 完整，推荐首选。",
         "needs_captcha": False, "auto": True, "available": True},
        {"id": "boomlify", "name": "boomlify", "label": "Boomlify (游客通道)",
         "desc": "boomlify.com，公开域名池 + 游客邮箱；触发限流后需要 Cloudflare Turnstile。",
         "needs_captcha": True, "auto": True, "available": True,
         "captcha_site_key": "0x4AAAAAABxNxT9frArMeW8F"},
        {"id": "temp.tf", "name": "temp.tf", "label": "temp.tf",
         "desc": "temp.tf，前端 Next.js；/api/check 风控严格，建议配合浏览器会话。",
         "needs_captcha": False, "auto": False, "available": False},
        {"id": "relay.firefox.com", "name": "relay.firefox.com", "label": "Firefox Relay (IMAP 转发)",
         "desc": "掩码地址转发到真实邮箱，收件走 IMAP；需要人工在 Relay 后台建别名并配置 IMAP。",
         "needs_captcha": False, "auto": False, "available": False},
    ]


if __name__ == "__main__":
    import sys
    name = sys.argv[1] if len(sys.argv) > 1 else "emailnator"
    p = get_provider(name)
    box = p.create()
    print(f"[{name}] 新地址: {box.address}")
    print("收件箱:", json.dumps(p.messages(box), ensure_ascii=False)[:600])
