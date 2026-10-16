"""browser.py — 浏览器托管：用 Playwright 驱动本机 Edge，替掉「DevTools 里抠 captcha_verify」。

解决两个痛点：
  1. **抓会话**：用户在托管的浏览器里正常登录/注册（滑块自然过），网关直接读 context 里的
     Cookie（含 HttpOnly，`document.cookie` 读不到）→ 一键入号池。零 DevTools、零复制粘贴。
  2. **自动过码**：托管窗口里只要发生过一次注册，网关就从网络请求里嗅出 `captcha_verify`，
     自动回填给正在 `waiting_captcha` 的补号任务 —— 用户不用再去找那串 token。

实现要点：
  * Playwright 的 sync API 必须在**固定线程**里用，所以这里起一个专属 worker 线程 + 命令队列。
  * 用 `launch_persistent_context` + 独立 profile，登录态能跨网关重启保留。
  * 用系统 Edge（`channel="msedge"`），不下载 Playwright 自带浏览器。
"""
from __future__ import annotations

import json
import os
import queue
import re
import threading
import time
from typing import Any, Callable, Optional

import config
import store

PROFILE_DIR = os.path.join(config.DATA_DIR, "browser-profile")
EDGE_CANDIDATES = [
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
]

LOGIN_URL = "https://modelscope.ai/"
REGISTER_URL = "https://modelscope.ai/login"

# 从请求里嗅 captcha_verify 的字段名（上游 sendEmail / loginRegister 的 body）
CAPTCHA_KEYS = ("captcha_verify", "captchaVerify", "captchaToken", "captcha_token")


def find_browser() -> str:
    for p in EDGE_CANDIDATES:
        if os.path.exists(p):
            return p
    return ""


# ==================================================================== 命令队列 worker
class _Worker:
    """把 Playwright 对象关在一个线程里，外部通过队列下命令。"""

    def __init__(self, mgr: "BrowserManager"):
        self.mgr = mgr
        self.q: queue.Queue = queue.Queue()
        self.thread: Optional[threading.Thread] = None

    def start(self) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.thread = threading.Thread(target=self._run, name="browser-worker", daemon=True)
        self.thread.start()

    def _run(self) -> None:
        from playwright.sync_api import sync_playwright
        try:
            with sync_playwright() as pw:
                self.mgr._pw = pw
                self.mgr._set_state("ready", "Playwright 已就绪")
                while True:
                    cmd, args, box = self.q.get()
                    if cmd == "__stop__":
                        break
                    try:
                        fn = getattr(self.mgr, "_do_" + cmd)
                        box["result"] = fn(**args)
                        box["ok"] = True
                    except Exception as e:
                        box["ok"] = False
                        box["error"] = f"{type(e).__name__}: {e}"
                        store.log("error", "browser", f"{cmd} 失败: {e}")
                    finally:
                        box["event"].set()
        except Exception as e:
            self.mgr._set_state("error", f"Playwright 启动失败: {e}")
            store.log("error", "browser", f"worker 崩溃: {e}")
        finally:
            self.mgr._pw = None

    def call(self, cmd: str, timeout: float = 90.0, **args) -> Any:
        self.start()
        box: dict[str, Any] = {"event": threading.Event()}
        self.q.put((cmd, args, box))
        if not box["event"].wait(timeout):
            raise TimeoutError(f"浏览器命令 {cmd} 超时（{timeout}s）")
        if not box.get("ok"):
            raise RuntimeError(box.get("error") or f"{cmd} 失败")
        return box.get("result")


# ==================================================================== 管理器
class BrowserManager:
    def __init__(self) -> None:
        self._pw = None
        self._ctx = None
        self._page = None
        self._lock = threading.RLock()
        self._worker = _Worker(self)
        self.state: dict[str, Any] = {
            "state": "idle",            # idle | ready | launching | running | error
            "message": "未启动",
            "url": "",
            "started_at": 0.0,
            "captcha": {},              # 最近嗅到的 captcha_verify
            "requests": 0,
            "last_cookie_count": 0,
        }

    # -------------------------------------------------- 状态
    def _set_state(self, st: str, msg: str) -> None:
        with self._lock:
            self.state["state"] = st
            self.state["message"] = msg

    def status(self) -> dict:
        with self._lock:
            s = dict(self.state)
        s["browser_path"] = find_browser()
        s["profile_dir"] = PROFILE_DIR
        s["alive"] = bool(self._ctx)
        if self._page:
            try:
                s["url"] = self._page.url
            except Exception:
                pass
        return s

    # -------------------------------------------------- 生命周期（在 worker 线程里跑）
    def _do_launch(self, url: str = LOGIN_URL, headless: bool = False,
                   width: int = 1280, height: int = 900) -> dict:
        self._set_state("launching", "正在启动浏览器…")
        os.makedirs(PROFILE_DIR, exist_ok=True)
        exe = find_browser()
        if not exe:
            raise RuntimeError("没找到 Edge/Chrome，请安装其中之一")

        if self._ctx is None:
            kwargs: dict[str, Any] = {
                "user_data_dir": PROFILE_DIR,
                "headless": headless,
                "viewport": {"width": width, "height": height},
                "args": ["--no-first-run", "--no-default-browser-check",
                         "--disable-features=msEdgeSidebarV2"],
                "ignore_default_args": ["--enable-automation"],
            }
            # 优先用系统 Edge/Chrome（channel），失败则回退到 Playwright 自带 chromium
            try:
                self._ctx = self._pw.chromium.launch_persistent_context(
                    channel=("msedge" if "msedge" in exe.lower() else "chrome"), **kwargs)
            except Exception as e:
                store.log("warn", "browser", f"channel 启动失败（{e}），回退 executable_path")
                kwargs["executable_path"] = exe
                self._ctx = self._pw.chromium.launch_persistent_context(**kwargs)

            self._ctx.set_default_timeout(30000)
            self._ctx.on("page", self._on_new_page)

        pages = [p for p in self._ctx.pages if not p.is_closed()]
        self._page = pages[0] if pages else self._ctx.new_page()
        self._attach_sniffer(self._page)

        if url:
            try:
                self._page.goto(url, wait_until="domcontentloaded", timeout=45000)
            except Exception as e:
                store.log("warn", "browser", f"打开 {url} 失败: {e}")

        with self._lock:
            self.state["started_at"] = time.time()
            self.state["url"] = self._page.url
        self._set_state("running", "浏览器运行中")
        return self.status()

    def _on_new_page(self, page) -> None:
        self._attach_sniffer(page)

    def _do_goto(self, url: str) -> dict:
        if not self._ctx:
            self._do_launch(url)
        else:
            self._page.goto(url, wait_until="domcontentloaded", timeout=45000)
        return self.status()

    def _do_close(self) -> dict:
        try:
            if self._ctx:
                self._ctx.close()
        except Exception:
            pass
        self._ctx = None
        self._page = None
        self._set_state("idle", "已关闭")
        return self.status()

    def _do_pages(self) -> list[dict]:
        if not self._ctx:
            return []
        out = []
        for p in self._ctx.pages:
            try:
                out.append({"url": p.url, "title": p.title(), "closed": p.is_closed()})
            except Exception:
                pass
        return out

    # -------------------------------------------------- 请求嗅探（抓 captcha_verify）
    def _attach_sniffer(self, page) -> None:
        try:
            page.on("request", self._on_request)
        except Exception:
            pass

    def _on_request(self, req) -> None:
        try:
            with self._lock:
                self.state["requests"] += 1
            url = req.url or ""
            if "/api/v1/auth/" not in url:
                return
            body = ""
            try:
                body = req.post_data or ""
            except Exception:
                return
            if not body:
                return
            for key in CAPTCHA_KEYS:
                m = re.search(r'"%s"\s*:\s*"([^"]+)"' % re.escape(key), body)
                if m and len(m.group(1)) > 8:
                    tok = m.group(1)
                    with self._lock:
                        self.state["captcha"] = {
                            "token": tok,
                            "url": url,
                            "at": time.time(),
                            "length": len(tok),
                            "email": (re.search(r'"email"\s*:\s*"([^"]+)"', body) or [None, ""])[1]
                                     if re.search(r'"email"\s*:\s*"([^"]+)"', body) else "",
                        }
                    store.log("info", "browser",
                              f"嗅到 captcha_verify（{len(tok)} 字符，来自 {url.rsplit('/', 1)[-1]}）")
                    self._feed_waiting_jobs(tok)
                    return
        except Exception:
            pass

    def _feed_waiting_jobs(self, token: str) -> None:
        """把 token 自动塞给正在等码的补号任务。"""
        try:
            import provision
            for job in list(provision.JOBS.values()):
                if job.status == "waiting_captcha":
                    job.supply_captcha(token)
                    store.log("info", "browser", f"已自动回填 captcha_verify 到任务 {job.id}")
        except Exception as e:
            store.log("warn", "browser", f"回填失败: {e}")

    # -------------------------------------------------- Cookie
    def _do_cookies(self, domain_filter: str = "modelscope") -> dict:
        if not self._ctx:
            raise RuntimeError("浏览器没在运行，先 launch")
        cookies = self._ctx.cookies()
        picked = [c for c in cookies if domain_filter in (c.get("domain") or "")]
        header = "; ".join(f"{c['name']}={c['value']}" for c in picked)
        with self._lock:
            self.state["last_cookie_count"] = len(picked)
        return {
            "count": len(picked),
            "header": header,
            "names": [c["name"] for c in picked],
            "cookies": [{"name": c["name"], "domain": c["domain"],
                         "httpOnly": c.get("httpOnly"), "secure": c.get("secure")}
                        for c in picked],
        }

    # -------------------------------------------------- 自动填表（尽力而为）
    def _do_prefill(self, email: str, username: str, password: str) -> dict:
        """往注册页的表单里灌值。选择器找不到就跳过，用户可以手填。"""
        if not self._page:
            raise RuntimeError("浏览器没在运行")
        js = """
        (args) => {
          const setVal = (el, v) => {
            if (!el || !v) return false;
            const proto = Object.getPrototypeOf(el);
            const desc = Object.getOwnPropertyDescriptor(proto, 'value');
            if (desc && desc.set) desc.set.call(el, v); else el.value = v;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
            return true;
          };
          const pick = (sels) => { for (const s of sels) { const e = document.querySelector(s); if (e) return e; } return null; };
          const emailEl = pick(['input[type=email]','input[name=email]','input[placeholder*="mail" i]','input[placeholder*="邮"]']);
          const userEl  = pick(['input[name=user_name]','input[name=username]','input[placeholder*="用户" i]','input[placeholder*="user" i]']);
          const passEls = Array.from(document.querySelectorAll('input[type=password]'));
          const out = { email: setVal(emailEl, args.email), user: setVal(userEl, args.username),
                        pass: 0 };
          passEls.forEach((el, i) => { if (setVal(el, args.password)) out.pass++; });
          return out;
        }
        """
        return self._page.evaluate(js, {"email": email, "username": username,
                                        "password": password})

    # -------------------------------------------------- 对外接口
    def launch(self, url: str = LOGIN_URL, headless: bool = False) -> dict:
        return self._worker.call("launch", timeout=120, url=url, headless=headless)

    def goto(self, url: str) -> dict:
        return self._worker.call("goto", timeout=90, url=url)

    def close(self) -> dict:
        return self._worker.call("close", timeout=60)

    def cookies(self, domain_filter: str = "modelscope") -> dict:
        return self._worker.call("cookies", timeout=60, domain_filter=domain_filter)

    def prefill(self, email: str, username: str, password: str) -> dict:
        return self._worker.call("prefill", timeout=60, email=email, username=username,
                                 password=password)

    def pages(self) -> list[dict]:
        return self._worker.call("pages", timeout=30)

    def latest_captcha(self, max_age: float = 600.0) -> dict:
        with self._lock:
            c = dict(self.state.get("captcha") or {})
        if c and (time.time() - c.get("at", 0)) <= max_age:
            return c
        return {}


BROWSER = BrowserManager()
