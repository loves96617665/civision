"""config.py — 运行配置（data/config.json 持久化，环境变量可覆盖）。"""
from __future__ import annotations

import json
import os
import secrets
from dataclasses import asdict, dataclass, field, fields
from typing import Any

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
os.makedirs(DATA_DIR, exist_ok=True)

CONFIG_FILE = os.path.join(DATA_DIR, "config.json")
ADMIN_TOKEN_FILE = os.path.join(DATA_DIR, "admin.token")
VERSION = "1.0.0"


def _sanitize_no_proxy() -> None:
    """httpx 的 URLPattern 无法解析 NO_PROXY 里的 `[::1]` 这种带方括号的条目，
    会抛 `InvalidURL: Invalid port: ':1]'`。这里在导入期清洗掉这类条目。"""
    for name in ("NO_PROXY", "no_proxy"):
        raw = os.environ.get(name)
        if not raw:
            continue
        kept = [p.strip() for p in raw.split(",")
                if p.strip() and "[" not in p and "]" not in p]
        os.environ[name] = ",".join(kept)


_sanitize_no_proxy()


@dataclass
class Settings:
    # 上游
    upstream_base: str = "https://modelscope.ai"
    site_mode: str = "INTERNATIONAL"          # INTERNATIONAL | COMMON
    accept_language: str = "zh-CN"
    bx_v: str = "2.5.37"
    proxy: str = ""
    timeout: float = 180.0                    # 单次生成等待上限（秒）
    connect_timeout: float = 20.0

    # 号池
    pool_size: int = 3                        # 期望健康账号数
    cooldown: float = 90.0                    # 429/5xx 冷却秒数
    strict_model: bool = True                 # 上游降级时是否报错
    max_attempts: int = 3                     # 单请求最多换几个号
    auto_refill: bool = False                 # 低于 pool_size 自动补号

    # 邮箱源
    mail_provider: str = "emailnator"         # emailnator | temp.tf | boomlify | relay.firefox.com
    mail_timeout: float = 240.0               # 等验证邮件上限

    # 注册
    register_user_prefix: str = "civ"
    register_password_len: int = 16
    from_site: str = "MaaS"
    captcha_scene_id: str = "49006ysb"
    captcha_prefix_cn: str = "18o9k0"
    captcha_prefix_intl: str = "183lxic"

    # 生成默认
    default_kind: str = "image"
    default_image_model: str = "z-image-turbo"      # 与源站首页默认一致
    default_video_model: str = ""                   # 空 = 用上游 defaultSdVersion
    poll_interval: float = 2.0

    # Firefox Relay / IMAP 收件（relay.firefox.com 模式）
    relay_alias: str = ""
    imap_host: str = ""
    imap_user: str = ""
    imap_pass: str = ""

    # 服务
    host: str = "127.0.0.1"
    port: int = 8787
    log_level: str = "info"
    max_log_rows: int = 5000

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    def update(self, patch: dict[str, Any]) -> "Settings":
        known = {f.name for f in fields(self)}
        for k, v in (patch or {}).items():
            if k in known and v is not None:
                cur = getattr(self, k)
                try:
                    if isinstance(cur, bool):
                        v = bool(v) if not isinstance(v, str) else v.lower() in ("1", "true", "yes", "on")
                    elif isinstance(cur, int) and not isinstance(cur, bool):
                        v = int(v)
                    elif isinstance(cur, float):
                        v = float(v)
                    elif isinstance(cur, str):
                        v = str(v)
                except (TypeError, ValueError):
                    continue
                setattr(self, k, v)
        return self


def _env_override(s: Settings) -> Settings:
    for f in fields(s):
        env = os.environ.get("CIVISION_" + f.name.upper())
        if env is not None:
            s.update({f.name: env})
    return s


def load_settings() -> Settings:
    s = Settings()
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as fh:
                s.update(json.load(fh))
        except Exception:
            pass
    return _env_override(s)


def save_settings(s: Settings) -> None:
    tmp = CONFIG_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as fh:
        json.dump(s.to_dict(), fh, ensure_ascii=False, indent=2)
    os.replace(tmp, CONFIG_FILE)


def admin_token() -> str:
    """管理台令牌：首次生成后持久化，控制台打印一次。"""
    env = os.environ.get("CIVISION_ADMIN_TOKEN")
    if env:
        return env
    if os.path.exists(ADMIN_TOKEN_FILE):
        tok = open(ADMIN_TOKEN_FILE, "r", encoding="utf-8").read().strip()
        if tok:
            return tok
    tok = "adm-" + secrets.token_hex(20)
    with open(ADMIN_TOKEN_FILE, "w", encoding="utf-8") as fh:
        fh.write(tok)
    try:
        os.chmod(ADMIN_TOKEN_FILE, 0o600)
    except OSError:
        pass
    return tok


SETTINGS = load_settings()
ADMIN_TOKEN = admin_token()
