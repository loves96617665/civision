"""run.py — 常驻启动器（供 scripts/civision.ps1 用 WMI 脱离进程树拉起）。

与 `uvicorn app:app` 的区别：
  1. 自己把 PID 写进 data/civision.pid，stop 时能精准定位（不依赖启动它的 shell）；
  2. 把 stdout/stderr 重定向到 logs/gateway.log，WMI 创建的进程没有控制台也能留日志；
  3. 支持 --host/--port 覆盖，优先级：命令行 > 环境变量 > config.json。
"""
from __future__ import annotations

import argparse
import os
import sys
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import config  # noqa: E402

PID_FILE = os.path.join(config.DATA_DIR, "civision.pid")
LOG_DIR = os.path.join(os.path.dirname(HERE), "logs")


def redirect_output() -> None:
    os.makedirs(LOG_DIR, exist_ok=True)
    out = open(os.path.join(LOG_DIR, "gateway.log"), "a", encoding="utf-8", buffering=1)
    err = open(os.path.join(LOG_DIR, "gateway.err.log"), "a", encoding="utf-8", buffering=1)
    sys.stdout = out
    sys.stderr = err
    try:
        os.dup2(out.fileno(), 1)
        os.dup2(err.fileno(), 2)
    except Exception:
        pass


def write_pid() -> None:
    with open(PID_FILE, "w", encoding="ascii") as fh:
        fh.write(str(os.getpid()))


def clear_pid() -> None:
    try:
        if os.path.exists(PID_FILE):
            cur = open(PID_FILE, encoding="ascii").read().strip()
            if cur == str(os.getpid()):
                os.remove(PID_FILE)
    except Exception:
        pass


def main() -> int:
    ap = argparse.ArgumentParser(description="civision-gateway 常驻启动器")
    ap.add_argument("--host", default=None)
    ap.add_argument("--port", type=int, default=None)
    ap.add_argument("--log-level", default=None)
    args = ap.parse_args()

    host = args.host or config.SETTINGS.host
    port = args.port or config.SETTINGS.port
    level = args.log_level or config.SETTINGS.log_level

    redirect_output()
    write_pid()

    import uvicorn
    print(f"\n{'=' * 72}", flush=True)
    print(f"[civision] pid={os.getpid()}  http://{host}:{port}/  upstream={config.SETTINGS.upstream_base}",
          flush=True)
    print(f"{'=' * 72}", flush=True)
    try:
        uvicorn.run("app:app", host=host, port=port, log_level=level, reload=False)
    except KeyboardInterrupt:
        pass
    except Exception:
        traceback.print_exc()
        return 1
    finally:
        clear_pid()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
