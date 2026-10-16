# civision-gateway

把 **ModelScope Civision**（`https://modelscope.ai/civision`）的生图 / 视频 / 音乐模型
封装成 **OpenAI 兼容 API 网关**，并附带一个与源站同主题的 **创作工作台 + 管理台 WebUI**。

- 🔌 **OpenAI 兼容面**：`/v1/models`、`/v1/images/generations`、`/v1/videos/generations`、`/v1/chat/completions`
- 🎨 **创作工作台**：参数与源站一致（21 图片 / 8 视频 / 3 音乐模型，含比例档位与默认推理参数）
- 🗂 **管理台**：API KEY 管理、号池管理、模型开关、一键注册补号
- 🧭 **浏览器托管**：Playwright 驱动系统 Edge，**不用 DevTools 就能拿会话、过验证码**
- 📮 **邮箱源**：emailnator / boomlify / temp.tf / relay.firefox.com
- 📄 **逆向报告**：[`docs/PROTOCOL.md`](docs/PROTOCOL.md) · **接口契约**：[`docs/API.md`](docs/API.md) · **过码指南**：[`docs/CAPTCHA.md`](docs/CAPTCHA.md)

---

## 快速开始

### 方式一：一键本地部署（推荐，常驻 + 自愈）

```powershell
# 装依赖 + 初始化 + 拉起常驻服务 + 注册自启/看门狗 + 端到端验证，一步到位
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1

# 换端口 / 允许局域网访问 / 不要自愈
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Port 9000
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -ExposeLan
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -NoAutostart
```

部署完自带**自愈**：

- 服务用 **WMI 创建进程**，不属于启动它的终端 —— 关窗口、终端被 kill 都不影响
- 注册计划任务 `civision-gateway`（登录时拉起）+ `civision-gateway-watchdog`（**每 1 分钟**探活）
- 进程被杀 / 僵死占端口 → 看门狗自动拉回（实测 54.5 秒恢复）
- PID 由 `server/run.py` 自己写盘，日志落在 `logs/`，心跳落在 `data/watchdog.heartbeat`

```powershell
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 status     # 状态
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 restart    # 重启
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 watchdog   # 手动跑看门狗
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 logs -Tail 80
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 selftest   # 端到端自检
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 open       # 打开工作台
```

> 本机是 **Windows PowerShell 5.1**（没有 `pwsh`），所以上面用 `powershell`。
> 装了 PowerShell 7 的话把 `powershell` 换成 `pwsh` 即可，脚本两者都兼容。
> `.ps1` 文件带 **UTF-8 BOM** —— PS 5.1 对无 BOM 的 UTF-8 会按 GBK 解析，中文注释会炸语法。

### 方式二：直接跑（前台，关窗口即停）

```powershell
python -m pip install -r requirements.txt
cd server; python run.py --port 8787
```

启动后打开 `http://127.0.0.1:8787/` → 管理台填令牌 → 号池加号或一键补号。

---

## 用起来

### OpenAI SDK

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1", api_key="sk-civ-...")

# 生图
r = client.images.generate(model="z-image-turbo", prompt="a cat on the moon",
                           size="1104x1472", n=1)
print(r.data[0].url)

# 视频
r = client.post("/videos/generations", body={
    "model": "wan2.2-i2v-a14b-bf16", "prompt": "waves crashing", "seconds": 5,
    "size": "480x848"})
print(r["id"], r["status"])
```

### curl

```bash
curl http://127.0.0.1:8787/v1/models -H "Authorization: Bearer sk-civ-..."

curl -X POST http://127.0.0.1:8787/v1/images/generations \
  -H "Authorization: Bearer sk-civ-..." -H "Content-Type: application/json" \
  -d '{"model":"z-image-turbo","prompt":"赛博朋克城市夜景","size":"1104x1472","n":2}'
```

### 兼容的客户端

任何支持自定义 `base_url` 的 OpenAI 客户端都能接：Cherry Studio / NextChat / LobeChat /
Open WebUI / SillyTavern / 各类绘图前端（把 base_url 指向 `http://127.0.0.1:8787/v1`）。

---

## 模型目录（逆向自源站 `defaultTemplateV2`）

**图片 21 个**：Z-Image / Z-Image-Turbo、Qwen-Image 全系（2.1 / 2512 / Edit 2511 / Edit 2509）、
FLUX.2-klein 4B/9B（含 base）、FLUX.1-dev、SD 1.5 / SDXL / SD3、Krea-2-Turbo、HiDream-O1、Ideogram-4、FireRed-Image-Edit

**视频 8 个**：Wan2.1（T2V-1.3B / T2V-14B / I2V-14B / FLF2V-14B）、
Wan2.2（TI2V-5B / T2V-A14B / I2V-A14B）、MiniMax-H3

**音乐 3 个**：ACE-Step XL（SFT / Turbo）、MiniMax-Music3

每个模型都带：`version_id`、`model` 仓库路径、比例档位（`label/width/height`）、
`default_params`（步数 / CFG / 采样器 / 种子）、支持采样器、最大边长。

别名规则：仓库名小写（`Tongyi-MAI/Z-Image-Turbo` → `z-image-turbo`）；
也接受 `sd_version` / `sub_version` / 仓库全名查询。

---

## 架构

```
civision-gateway/
├── server/
│   ├── app.py          FastAPI：三套接口 + 任务调度 + 静态 WebUI
│   ├── civision.py     上游协议客户端（/api 与 /openapi 双通道）
│   ├── pool.py         号池：轮换 / 故障转移 / 冷却 / 能力卡 / 自动补号
│   ├── provision.py    一键注册（RSA 密码加密 + 邮箱收信 + 验证码闸门）
│   ├── mailbox.py      邮箱源适配（4 个 provider）
│   ├── registry.py     模型注册表（别名 / 开关 / 目录）
│   ├── keystore.py     API KEY（明文只返回一次，库里存 sha256）
│   ├── crypto.py       上游硬编码 RSA 公钥加密
│   ├── store.py        SQLite（WAL）
│   └── config.py       配置 + 管理令牌
├── webui/              创作工作台 + 管理台（零依赖原生前端）
├── docs/PROTOCOL.md    上游逆向报告
├── docs/API.md         接口契约
└── tests/smoke_test.py 34 项端到端冒烟测试
```

### 请求流转

```
客户端 ──Bearer KEY──▶ /v1/images/generations
                          │ 校验 KEY / 模型开关 / 权限
                          ▼
                       建任务 (SQLite) ──▶ 后台线程
                          │                  │ pool.acquire() 选号
                          │                  ▼
                          │            CivisionClient 组装上游请求体
                          │            POST {upstream}/api/v1/aigc/agentic/image/generate
                          │                  │ 失败→换号重试（≤max_attempts）
                          │                  ▼
                          │            递归抽取产物 URL（兼容未知字段名）
                          ▼                  │
                      轮询任务 ◀─────────────┘
```

### 号池策略

1. `acquire()` 打分：能力卡 `direct`=3 → 未知=2 → `fallback`=1 → `error`=0；
   同分按 `(last_used, requests)` + 轮询打散，能力优先且负载均衡。
2. 失败分类：`auth`（401/未登录）→ 永久禁用该号；`quota` → 冷却 1h；
   `rate`（429）→ 冷却 `cooldown` 秒；其他 → 冷却。
3. 单请求最多换 `max_attempts` 个号，全失败抛 `PoolExhausted`（网关回 502）。
4. 自动补号：`auto_refill=true` 且健康号 < `pool_size` 时触发注册任务。

### 一键注册链路（已实测跑通到验证码闸门）

```
emailnator 生成 @googlemail.com
  → POST /api/v1/auth/check           校验邮箱/用户名
  → POST /api/v1/auth/sendEmail       password = RSA-PKCS1v15(pwd) 的 Base64
  → 收激活邮件 → 抽确认链接 → GET 链接
  → POST /api/v1/auth/loginRegister   callback_url = {upstream}/login
  → 从 Set-Cookie 抽会话 → 入库
```

**验证码闸门**：上游用阿里云验证码 2.0（SceneId `49006ysb`，prefix 国内 `18o9k0` / 国际 `183lxic`）。
实测返回 `CaptchaVerify cannot be empty`。网关处理方式：

| 路径 | 说明 |
|---|---|
| 人工过码 | 任务进入 `waiting_captcha`，管理台弹窗粘贴 `captcha_verify` → `POST /admin/api/pool/refill/{job}/captcha` |
| 浏览器托管 | 用本机 Chromium（CDP）自动填表，滑块人工拖一次 |
| 降级探测 | 部分网络档位下 `captcha_verify` 可为空，网关自动尝试 |

### 手动加号

不想走注册流程时，直接在浏览器登录 `modelscope.ai`，F12 → Network → 任一
`/api/v1/` 请求 → 复制 `Cookie` 请求头，粘贴进管理台「号池 → 手动添加」。

### 过码与补号（三种方式）

上游注册链路的唯一阻塞点是**阿里云验证码**（滑块）。详见 **[`docs/CAPTCHA.md`](docs/CAPTCHA.md)**：

| 方式 | 你要做的 | 说明 |
|---|---|---|
| **① 浏览器托管 → 抓取会话**（推荐） | 在托管窗口里正常登录，回来点一下「抓取会话入库」 | 网关直接读 Cookie（含 HttpOnly），**完全不碰 DevTools** |
| **② 托管注册** | 点「注册」+ 拖一次滑块 | 自动建邮箱、自动预填、**自动接住 captcha_verify** 继续跑完注册 |
| **③ 手动粘贴** | 从 F12 复制 token | 兜底；粘贴容错，带前缀/引号/整段 JSON 都能识别 |

托管浏览器基于 Playwright 驱动系统 Edge，独立持久化 profile（登录态跨重启保留）。

---

## 配置

`server/data/config.json`（也可用 `CIVISION_<字段名大写>` 环境变量覆盖）：

| 字段 | 默认 | 说明 |
|---|---|---|
| `upstream_base` | `https://modelscope.ai` | 上游地址（国内站换 `https://modelscope.cn`） |
| `proxy` | `""` | 显式代理；留空则用系统环境代理 |
| `timeout` | `180` | 单次生成等待上限（秒） |
| `pool_size` | `3` | 期望健康账号数 |
| `cooldown` | `90` | 429/5xx 冷却秒数 |
| `strict_model` | `true` | 上游降级时报错而不是静默返回 |
| `max_attempts` | `3` | 单请求最多换几个号 |
| `auto_refill` | `false` | 自动补号 |
| `mail_provider` | `emailnator` | 默认邮箱源 |
| `default_image_model` | `z-image-turbo` | 工作台默认图片模型（对齐源站） |
| `relay_alias` / `imap_*` | `""` | Firefox Relay 模式 |

> **注意**：本机若设置了 `NO_PROXY` 且含 `[::1]` 这类带方括号的条目，
> httpx 会抛 `InvalidURL: Invalid port: ':1]'`。`config.py` 在导入期已自动清洗。

---

## 测试

```powershell
# 起服务后
cd tests
$env:ADMIN_TOKEN="<启动横幅里的令牌>"
$env:GW_KEY="<API KEY>"
python smoke_test.py
```

覆盖：WebUI 托管、管理鉴权、OpenAI 鉴权、模型列表与分类、模型开关生效、
KEY 创建/范围/删除、号池增删改查与批量导入、任务生命周期、图片/视频接口错误语义、
邮箱源清单、补号分步轨迹、设置读写、日志、端到端自检。**34 项全绿**。

---

## 免责与边界

- 本项目是**协议封装与实验工具**，默认把上游当作你自有/实验室环境中的目标。
- 上游接口未公开、随时可能变更；`docs/PROTOCOL.md` 第 8 节列出了尚未定稿的字段
  （Agent SSE 事件内部结构、视频是否异步返回 task_id），需要真实账号跑一次才能定稿。
- 注册链路依赖第三方临时邮箱与上游风控档位，**通过率不保证**。
- 请遵守目标站点的服务条款与当地法律。
