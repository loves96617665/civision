"""_init_data.py — 部署用：初始化数据目录、灌模型注册表、确保有一把本地 KEY。

输出是给 PowerShell 读的简单 KV 行，避免在 shell 里拼 Python 字符串。
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(HERE), "server")
sys.path.insert(0, SERVER)

import config  # noqa: E402
import keystore  # noqa: E402
import registry  # noqa: E402
import store  # noqa: E402


def main() -> int:
    store.init()
    added = registry.seed_db()
    counts = registry.models_view()["counts"]

    keys = keystore.list_keys()
    new_key = ""
    if not keys:
        k = keystore.create_key("local", note="本地部署自动生成")
        new_key = k["key"]

    data = os.path.join(SERVER, "data")
    files = {f: os.path.exists(os.path.join(data, f))
             for f in ("config.json", "registry.json", "gateway.db", "admin.token")}

    out = {
        "seeded": added,
        "models_total": counts["total"],
        "models_enabled": counts["enabled"],
        "admin_token": config.ADMIN_TOKEN,
        "keys_existing": len(keys),
        "new_key": new_key,
        "files": files,
        "upstream": config.SETTINGS.upstream_base,
        "host": config.SETTINGS.host,
        "port": config.SETTINGS.port,
    }
    print("CIVISION_INIT " + json.dumps(out, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
