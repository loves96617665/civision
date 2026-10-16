"""smoke_test.py — civision-gateway 端到端冒烟测试（不需要真实上游账号）。"""
from __future__ import annotations

import json
import os
import sys
import time

import requests

BASE = os.environ.get("GW", "http://127.0.0.1:8787")
ADMIN = os.environ.get("ADMIN_TOKEN", "")
KEY = os.environ.get("GW_KEY", "")

if not ADMIN or not KEY:
    sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "server"))
    import config
    ADMIN = ADMIN or config.ADMIN_TOKEN
    import keystore
    import store
    store.init()
    k = keystore.create_key("smoke-" + str(int(time.time())))
    KEY = k["key"]

H = {"Authorization": f"Bearer {KEY}"}
AH = {"X-Admin-Token": ADMIN}

PASS, FAIL = [], []


def check(name: str, cond: bool, detail: str = "") -> None:
    (PASS if cond else FAIL).append(name)
    mark = "PASS" if cond else "FAIL"
    print(f"  [{mark}] {name}" + (f"  -- {detail[:200]}" if detail else ""))


def j(r):
    try:
        return r.json()
    except Exception:
        return {"_status": r.status_code, "_text": r.text[:300]}


print("=" * 70)
print("civision-gateway 冒烟测试  ", BASE)
print("=" * 70)

# ---------------------------------------------------------------- 基础
r = requests.get(BASE + "/", timeout=15)
check("GET / 返回 WebUI", r.status_code == 200 and "<html" in r.text.lower(), str(r.status_code))

r = requests.get(BASE + "/admin/api/overview", headers=AH, timeout=30)
d = j(r)
check("GET /admin/api/overview", r.status_code == 200 and "pool" in d, json.dumps(d, ensure_ascii=False)[:200])

r = requests.get(BASE + "/admin/api/overview", timeout=15)
check("管理接口拒绝无令牌", r.status_code == 401, str(r.status_code))

r = requests.get(BASE + "/v1/models", timeout=15)
check("OpenAI 接口拒绝无 KEY", r.status_code == 401, str(r.status_code))

# ---------------------------------------------------------------- 模型
r = requests.get(BASE + "/v1/models", headers=H, timeout=15)
d = j(r)
n = len(d.get("data", []))
check("GET /v1/models", r.status_code == 200 and n >= 30, f"{n} 个模型")
kinds = {}
for m in d.get("data", []):
    kinds[m["meta"]["kind"]] = kinds.get(m["meta"]["kind"], 0) + 1
check("模型分类齐全", kinds.get("image", 0) >= 20 and kinds.get("video", 0) >= 8, str(kinds))

# ---------------------------------------------------------------- Studio 目录
r = requests.get(BASE + "/studio/api/catalog", headers=H, timeout=40)
d = j(r)
check("GET /studio/api/catalog", r.status_code == 200 and d.get("image"), str(r.status_code))
check("目录含真实默认参数",
      bool((d.get("image") or [{}])[0].get("default_params")), "default_params")
zi = next((m for m in d.get("image", []) if m["alias"] == "z-image-turbo"), None)
check("Z-Image-Turbo 在目录中", zi is not None and zi["model"] == "Tongyi-MAI/Z-Image-Turbo",
      json.dumps(zi, ensure_ascii=False)[:160] if zi else "not found")
check("Z-Image-Turbo 尺寸档位", bool(zi and len(zi["sizes"]) >= 5),
      str([s["label"] for s in (zi or {}).get("sizes", [])]))
wan = next((m for m in d.get("video", []) if m["model"].startswith("Wan-AI/Wan2.2-I2V")), None)
check("Wan2.2 I2V 在视频目录", wan is not None and wan["version_id"] == 647,
      json.dumps(wan, ensure_ascii=False)[:160] if wan else "not found")
check("站点默认模型 = z-image-turbo", d.get("defaults", {}).get("image") == "z-image-turbo",
      str(d.get("defaults", {}).get("image")))

# ---------------------------------------------------------------- 模型开关
r = requests.patch(BASE + "/admin/api/models/flux.2-klein-9b", headers=AH,
                   json={"enabled": False}, timeout=15)
check("PATCH /admin/api/models/{alias} 关闭模型", r.status_code == 200, str(r.status_code))
r = requests.get(BASE + "/v1/models", headers=H, timeout=15)
ids = [m["id"] for m in j(r).get("data", [])]
check("停用后不再出现在 /v1/models", "flux.2-klein-9b" not in ids, f"{len(ids)} 个")
r = requests.post(BASE + "/v1/images/generations", headers=H,
                  json={"model": "flux.2-klein-9b", "prompt": "x"}, timeout=20)
check("停用模型调用返回 404", r.status_code == 404, f"{r.status_code} {j(r)}")
requests.patch(BASE + "/admin/api/models/flux.2-klein-9b", headers=AH,
               json={"enabled": True}, timeout=15)

# ---------------------------------------------------------------- API KEY
r = requests.post(BASE + "/admin/api/keys", headers=AH,
                  json={"name": "smoke-child", "models": ["z-image-turbo"], "quota": 100}, timeout=15)
k2 = j(r)
check("POST /admin/api/keys 创建", r.status_code == 200 and k2.get("key", "").startswith("sk-civ-"),
      k2.get("masked", ""))
kid = k2.get("id")
r = requests.get(BASE + "/admin/api/keys", headers=AH, timeout=15)
check("GET /admin/api/keys 列表", r.status_code == 200 and any(
    x["id"] == kid for x in j(r).get("items", [])), f"{len(j(r).get('items', []))} 把")
H2 = {"Authorization": f"Bearer {k2['key']}"}
r = requests.get(BASE + "/v1/models", headers=H2, timeout=15)
ids2 = [m["id"] for m in j(r).get("data", [])]
check("KEY 模型范围生效", ids2 == ["z-image-turbo"], str(ids2))
r = requests.delete(BASE + "/admin/api/keys/" + kid, headers=AH, timeout=15)
check("DELETE /admin/api/keys/{id}", r.status_code == 200, str(r.status_code))

# ---------------------------------------------------------------- 号池
r = requests.post(BASE + "/admin/api/accounts", headers=AH,
                  json={"cookie": "csrf_token=smoketest; sid=abcdef1234567890",
                        "label": "smoke@test", "email": "smoke@test"}, timeout=15)
acc = j(r)
check("POST /admin/api/accounts 添加账号", r.status_code == 200 and acc.get("id"), str(acc.get("id")))
aid = acc.get("id")
r = requests.get(BASE + "/admin/api/accounts", headers=AH, timeout=15)
check("GET /admin/api/accounts", r.status_code == 200 and any(
    a["id"] == aid for a in j(r).get("items", [])), str(j(r).get("count")))
r = requests.post(BASE + "/admin/api/accounts/import", headers=AH,
                  json={"text": "csrf_token=a1; sid=1\ncsrf_token=a2; sid=2"}, timeout=15)
check("POST /admin/api/accounts/import 批量", r.status_code == 200 and len(j(r).get("items", [])) == 2,
      str(len(j(r).get("items", []))))
r = requests.post(BASE + f"/admin/api/accounts/{aid}/enable", headers=AH, json={"enabled": False},
                  timeout=15)
check("账号禁用", r.status_code == 200 and j(r).get("enabled") is False, str(r.status_code))
requests.post(BASE + f"/admin/api/accounts/{aid}/enable", headers=AH, json={"enabled": True}, timeout=15)

# ---------------------------------------------------------------- 生成（无可用上游，应优雅失败）
r = requests.post(BASE + "/studio/api/generate", headers=H,
                  json={"kind": "image", "model": "z-image-turbo", "prompt": "a cat",
                        "width": 1104, "height": 1472}, timeout=20)
g = j(r)
check("POST /studio/api/generate 建任务", r.status_code == 200 and g.get("task_id"), str(g))
tid = g.get("task_id")
if tid:
    deadline = time.time() + 90
    while time.time() < deadline:
        rr = requests.get(BASE + f"/studio/api/tasks/{tid}", headers=H, timeout=15)
        tv = j(rr)
        if tv.get("status") in ("succeeded", "failed"):
            break
        time.sleep(2)
    check("任务落到终态", tv.get("status") in ("succeeded", "failed"),
          f"status={tv.get('status')} err={(tv.get('error') or '')[:140]}")
    print(f"       → 任务结果: {tv.get('status')} / {tv.get('error', '')[:180]}")

r = requests.post(BASE + "/v1/images/generations", headers=H,
                  json={"model": "z-image-turbo", "prompt": "a cat", "size": "1104x1472",
                        "timeout": 30}, timeout=120)
d = j(r)
check("POST /v1/images/generations 有明确错误语义",
      r.status_code in (200, 402, 429, 502, 504) and ("data" in d or "error" in d),
      f"{r.status_code} {json.dumps(d, ensure_ascii=False)[:200]}")

r = requests.post(BASE + "/v1/videos/generations", headers=H,
                  json={"model": "wan2.2-i2v-a14b-bf16", "prompt": "a cat", "seconds": 5,
                        "timeout": 30}, timeout=120)
d = j(r)
check("POST /v1/videos/generations", "status" in d or "error" in d,
      f"{r.status_code} {json.dumps(d, ensure_ascii=False)[:160]}")

# ---------------------------------------------------------------- 邮箱源 / 补号
r = requests.get(BASE + "/admin/api/mail/providers", headers=AH, timeout=15)
d = j(r)
names = [p["name"] for p in d.get("items", [])]
check("GET /admin/api/mail/providers 四个源齐全",
      all(x in names for x in ("emailnator", "boomlify", "temp.tf", "relay.firefox.com")),
      str(names))

r = requests.post(BASE + "/admin/api/pool/refill", headers=AH,
                  json={"count": 1, "provider": "emailnator", "verify": True}, timeout=20)
d = j(r)
check("POST /admin/api/pool/refill 起任务", r.status_code == 200 and d.get("job"), str(d.get("job")))
job = d.get("job")
if job:
    seen = []
    deadline = time.time() + 120
    while time.time() < deadline:
        rr = requests.get(BASE + f"/admin/api/pool/refill/{job}", headers=AH, timeout=15)
        jv = j(rr)
        seen = [s["stage"] for s in jv.get("steps", [])]
        if jv.get("status") in ("done", "failed"):
            break
        time.sleep(3)
    check("补号任务产生分步轨迹", "mailbox" in seen and ("sendEmail" in seen or "check" in seen),
          str(seen))
    print(f"       → 补号结果: {jv.get('status')} steps={seen}")
    print(f"       → 末步: {(jv.get('steps') or [{}])[-1].get('message', '')[:200]}")

# ---------------------------------------------------------------- 设置 / 日志 / 自检
r = requests.get(BASE + "/admin/api/settings", headers=AH, timeout=15)
check("GET /admin/api/settings", r.status_code == 200 and "upstream_base" in j(r), str(r.status_code))
r = requests.put(BASE + "/admin/api/settings", headers=AH,
                 json={"cooldown": 120, "pool_size": 4}, timeout=15)
d = j(r)
check("PUT /admin/api/settings", d.get("cooldown") == 120 and d.get("pool_size") == 4, str(d.get("cooldown")))
r = requests.get(BASE + "/admin/api/logs?limit=20", headers=AH, timeout=15)
check("GET /admin/api/logs", r.status_code == 200 and isinstance(j(r).get("items"), list),
      f"{len(j(r).get('items', []))} 条")
r = requests.post(BASE + "/admin/api/selftest", headers=AH, timeout=90)
d = j(r)
check("POST /admin/api/selftest", "steps" in d, json.dumps(d, ensure_ascii=False)[:300])

# ---------------------------------------------------------------- 清理
for a in j(requests.get(BASE + "/admin/api/accounts", headers=AH, timeout=15)).get("items", []):
    if a["label"].startswith(("smoke", "批量导入")):
        requests.delete(BASE + f"/admin/api/accounts/{a['id']}", headers=AH, timeout=15)

print("\n" + "=" * 70)
print(f"通过 {len(PASS)} 项，失败 {len(FAIL)} 项")
if FAIL:
    print("失败项：")
    for f in FAIL:
        print("   -", f)
print("=" * 70)
sys.exit(1 if FAIL else 0)
