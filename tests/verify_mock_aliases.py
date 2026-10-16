"""verify_mock_aliases.py — 校验 webui/mock.js 推导出的模型别名与后端注册表逐字一致。

用法： python tests/verify_mock_aliases.py
"""
from __future__ import annotations

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "server"))

import registry  # noqa: E402
import store  # noqa: E402


def alias_of(model: str, sub_label: str) -> str:
    """与 mock.js::aliasOf 及 registry._alias_for 等价的 Python 版。"""
    repo = (model or "").split("/")[-1]
    pick = repo if repo and not repo[:1].isdigit() else (sub_label or repo)
    s = re.sub(r"[^a-z0-9.\-_]+", "-", str(pick).lower())
    s = re.sub(r"-{2,}", "-", s)
    return s.strip("-.")


def main() -> int:
    mock = open(os.path.join(ROOT, "webui", "mock.js"), encoding="utf-8").read()

    # 抽出所有 "模型仓库名"，配对同一行紧邻其前的那个字符串（行格式里是 sub_label）
    pairs: set[tuple[str, str]] = set()
    for line in mock.splitlines():
        m = re.search(r"'([A-Za-z0-9\-]+/[A-Za-z0-9\.\-_]+)'", line)
        if not m:
            continue
        model = m.group(1)
        if model.startswith(("//", "http")) or model in ("N/A", "n/a"):
            continue
        labels = re.findall(r"'([^']*)'", line)
        sub_label = ""
        if model in labels:
            idx = labels.index(model)
            if idx >= 1:
                sub_label = labels[idx - 1]
        pairs.add((model, sub_label))

    store.init()
    server = {e["model"]: e["alias"] for e in registry.entries()}

    ok, bad, unknown = [], [], []
    for model, sub_label in sorted(pairs):
        if model not in server:
            unknown.append(model)
            continue
        got = alias_of(model, sub_label)
        if got == server[model]:
            ok.append((model, got))
        else:
            bad.append((model, got, server[model], sub_label))

    print(f"mock 中出现的模型仓库名: {len(pairs)}  |  命中注册表: {len(ok) + len(bad)}")
    print(f"  一致: {len(ok)}   不一致: {len(bad)}   注册表里没有: {len(unknown)}")
    for model, got, want, sl in bad:
        print(f"  [MISMATCH] {model}\n      mock={got}  server={want}  (sub_label={sl!r})")
    for m in unknown:
        print(f"  [NOT IN REGISTRY] {m}")

    # 反向：注册表里没被 mock 覆盖的（允许，仅提示）
    mock_models = {m for m, _ in pairs}
    missing = [a for m, a in server.items() if m not in mock_models]
    if missing:
        print(f"  注册表有但 mock 未覆盖: {len(missing)} 个 -> {sorted(missing)[:8]}")

    return 1 if bad else 0


if __name__ == "__main__":
    raise SystemExit(main())
