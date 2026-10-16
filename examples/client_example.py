"""client_example.py — 用 OpenAI SDK 打 civision-gateway。

先起服务：  cd server; python -m uvicorn app:app --port 8787
再跑：      python examples/client_example.py sk-civ-xxxx
"""
from __future__ import annotations

import json
import sys
import time

import requests

BASE = "http://127.0.0.1:8787"


def main(key: str) -> int:
    H = {"Authorization": f"Bearer {key}"}

    print("=" * 70)
    print("1) 模型列表")
    r = requests.get(f"{BASE}/v1/models", headers=H, timeout=20)
    models = r.json()["data"]
    by_kind: dict[str, list[str]] = {}
    for m in models:
        by_kind.setdefault(m["meta"]["kind"], []).append(m["id"])
    for k, v in by_kind.items():
        print(f"   {k:<6} ({len(v)}): {', '.join(v[:6])}{' …' if len(v) > 6 else ''}")

    print("\n2) 用 OpenAI SDK 生图（需要号池里有可用账号）")
    try:
        from openai import OpenAI
    except ImportError:
        print("   [skip] 未安装 openai，改用 requests")
        OpenAI = None

    if OpenAI:
        client = OpenAI(base_url=f"{BASE}/v1", api_key=key, timeout=300)
        try:
            resp = client.images.generate(
                model="z-image-turbo",
                prompt="一只橘猫坐在月球表面，背后地球升起，35mm 摄影级细节",
                size="1024x1024", n=1,
                extra_body={"steps": 30, "guidance_scale": 4, "seed": -1},
            )
            print("   ->", resp.data[0].url)
        except Exception as e:
            print(f"   [预期内失败] {type(e).__name__}: {str(e)[:300]}")

    print("\n3) 视频：建任务 + 轮询")
    r = requests.post(f"{BASE}/v1/videos/generations", headers=H, timeout=300,
                      json={"model": "wan2.2-i2v-a14b-bf16",
                            "prompt": "海浪拍打礁石，慢镜头，黄昏",
                            "seconds": 5, "size": "480x848", "timeout": 60})
    d = r.json()
    vid = d.get("id")
    print(f"   {r.status_code} id={vid} status={d.get('status')} err={d.get('error')}")
    for _ in range(20):
        if not vid:
            break
        rr = requests.get(f"{BASE}/v1/videos/{vid}", headers=H, timeout=20).json()
        print(f"   poll -> {rr.get('status')} {[x['url'] for x in rr.get('data', [])]}")
        if rr.get("status") in ("succeeded", "failed"):
            break
        time.sleep(3)

    print("\n4) 工作台目录（模型 + 默认参数 + 比例档位）")
    r = requests.get(f"{BASE}/studio/api/catalog", headers=H, timeout=40)
    cat = r.json()
    zi = next((m for m in cat["image"] if m["alias"] == "z-image-turbo"), None)
    if zi:
        print("   z-image-turbo:", zi["model"], "v" + str(zi["version_id"]))
        print("   比例:", [(s["label"], f"{s['width']}x{s['height']}") for s in zi["sizes"]])
        print("   默认:", json.dumps(zi["default_params"].get("basicDiffusionArgs", {}),
                                     ensure_ascii=False))
    print("   站点默认:", cat["defaults"]["image"], "/", cat["defaults"]["video"])

    print("\n5) 健康摘要")
    print("  ", json.dumps(requests.get(f"{BASE}/studio/api/health", headers=H,
                                       timeout=60).json(), ensure_ascii=False)[:400])
    return 0


if __name__ == "__main__":
    k = sys.argv[1] if len(sys.argv) > 1 else input("API KEY (sk-civ-...): ").strip()
    raise SystemExit(main(k))
