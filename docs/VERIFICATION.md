# 验证记录（civision-gateway）

所有结论都有可复现的命令与原始输出。测试环境：Windows / Python 3.12.10 /
`https://modelscope.ai`（经本机系统代理 `127.0.0.1:7897` 出网）。

---

## 1. 上游协议：静态逆向证据

| 证据 | 位置 |
|---|---|
| 前端 chunk 全量快照（205 个 asset） | `D:\DSH\recon\civision\assets\` |
| 模型目录原始响应 | `D:\DSH\recon\civision\defaultTemplateV2.json`（99 KB） |
| 归一化模型注册表 | `server\data\registry.json` |
| 主题令牌（54 个，`[dark, light]` 二元组） | `webui\theme-tokens.json` + `webui\theme.css` |
| 逆向脚本链 | `D:\DSH\recon\civision\01_pull_assets.py` … `18_boomlify_addr.py` |

关键提取（`usePendingSubmit-DszbHQD1.js`）：

```js
// 图片自定义生成
Rt = e => pe(`${Mt}/v1/aigc/agentic/image/generate`, {method:'POST', credentials:'include', ...})
// 视频生成（OpenAPI 通道，绝对路径）
Ht = e => pe('/openapi/v1/aigc/agentic/video/generate', {method:'POST', credentials:'include', ...})
// 额度
Xt = e => pe('/openapi/v1/aigc/agentic/estimate-quota', {method:'POST', ...})
```

请求体构造（同一 chunk）：

```js
{ type:'IMAGE', mode:'custom', predict_task_request:{
    predict_type: 有参考图 ? 'IMG_2_IMG' : 'TXT_2_IMG',
    prompt_args:{prompt},
    basic_diffusion_args:{width,height,num_images_per_prompt},
    model_args:{model, lora_args:[{model_version_id}]},
    ...(有参考图 ? {image_input_front_args:{image,strength:1}} : {}) } }
```

---

## 2. 上游可达性与公开接口（无凭证）

```powershell
cd D:\DSH\civision-gateway\server
python -c "import civision; print(civision.probe_reachable())"
```

实测输出：

```
catalog OK: image=21 video=8 audio=3
probe: {'reachable': True, 'latency_ms': 4270, 'error': ''}
```

无凭证探测结果（`D:\DSH\recon\civision\probe_api.json`）：

| 接口 | 结果 |
|---|---|
| `GET /api/v1/muse/predict/unauth/defaultTemplateV2` | **200**，42 KB 模型目录 |
| `GET /api/v1/models/aigc/tags` | **200**，风格标签 |
| `GET /api/v1/banners?Position=home` | 200 |
| `POST /api/v1/aigc/picture/list` | 200 |
| `POST /api/v1/aigc/agentic/image/generate` | 401 `{"Code":10010101003,"Message":"user not logged in"}` |
| `POST /openapi/v1/aigc/agentic/estimate-quota` | 401 `{"success":false,"code":"InvalidAuthentication"}` |
| `GET /openapi/v1/byok/models` | 401 `InvalidAuthentication` |

→ 确认了双通道与两套错误结构（站内 `Code/Message/Success`，OpenAPI `code/message/success`）。

---

## 3. 模型目录与源站参数一致性

```powershell
cd D:\DSH\civision-gateway\server
python -c "import registry,store;store.init();[print(e['alias'],registry.sizes_of(e),e.get('default_params')) for e in registry.entries() if e['alias'] in ('z-image-turbo','wan2.2-i2v-a14b-bf16','qwen-image-2512')]"
```

实测：

| 别名 | 上游仓库 | version_id | 比例档位 | 默认参数 |
|---|---|---|---|---|
| `z-image-turbo` | `Tongyi-MAI/Z-Image-Turbo` | 692 | 9:16 720×1280 · 3:4 864×1152 · 1:1 1024×1024 · 4:3 1152×864 · 16:9 1280×720 | CFG 4 · 30 步 · 1024×1024 |
| `qwen-image-2512` | `Qwen/Qwen-Image-2512` | 1363 | 9:16 928×1664 · 3:4 1104×1472 · 1:1 1328×1328 · 4:3 1472×1104 · 16:9 1664×928 | CFG 4 · 1104×1472 |
| `wan2.2-i2v-a14b-bf16` | `Wan-AI/Wan2.2-I2V-A14B-BF16` | 647 | large 720×1280… + small 480×848… | CFG 7.5 · 50 步 · 720×1280 |

WebUI 截图里的比例档位与上表**逐项一致**（工作台显示 `1:1 · 1024×1024`、`3:4 · 864×1152` …）。

---

## 4. 端到端冒烟测试：34/34 通过

```powershell
cd D:\DSH\civision-gateway\tests
$env:ADMIN_TOKEN="<启动横幅>"; $env:GW_KEY="<启动横幅>"
python smoke_test.py
```

```
通过 34 项，失败 0 项
```

覆盖范围：

- WebUI 托管、管理接口拒绝无令牌、OpenAI 接口拒绝无 KEY
- `GET /v1/models` → 32 个模型（图片 21 / 视频 8 / 音乐 3）
- `GET /studio/api/catalog` → 含真实 `default_params`、尺寸档位、站点默认模型 `z-image-turbo`
- 模型开关：关闭 `flux.2-klein-9b` → 从 `/v1/models` 消失 → 调用返回 404 → 重新打开
- API KEY：创建（返回一次性明文）→ 模型范围生效（只剩 `z-image-turbo`）→ 删除
- 号池：添加 / 批量导入 / 禁用 / 启用
- 任务生命周期：`queued → running → failed`（假 Cookie 下正确报 `user not logged in`）
- `/v1/images/generations` 与 `/v1/videos/generations` 的错误语义（502/504 + `error.type`）
- 邮箱源清单、补号任务分步轨迹、设置读写、日志、端到端自检

---

## 5. 一键注册：实测跑通到验证码闸门

```powershell
# 起服务后
Invoke-RestMethod -Uri http://127.0.0.1:8787/admin/api/pool/refill -Method Post `
  -Headers @{"X-Admin-Token"="<token>"} -ContentType application/json `
  -Body '{"count":1,"provider":"emailnator","verify":true}'
```

实测轨迹（`tests/refill_result.json`）：

```
[0] running          steps = mailbox > mailbox > mailbox
[1] waiting_captcha  steps = mailbox > mailbox > mailbox > check > sendEmail > captcha

mailbox    : 新地址 e.mayaan.and26.4@googlemail.com          ← emailnator 真实 Gmail
check      : auth/check -> {"code":0,"msg":"check successfully","success":true}
sendEmail  : code=-2 success=False msg=CaptchaVerify cannot be empty
captcha    : 等待人工完成阿里云验证码（在管理台粘贴 captcha_verify）

need_captcha = {"email":"e.mayaan.and26.4@googlemail.com",
                "scene_id":"49006ysb","prefix_cn":"18o9k0","prefix_intl":"183lxic",
                "reason":"CaptchaVerify cannot be empty"}
```

**结论**：邮箱源接入 ✅、`auth/check` ✅、RSA 密码加密被上游接受 ✅、
唯一的阻塞点就是阿里云验证码 —— 与静态逆向结论完全吻合，任务正确转入
`waiting_captcha` 等待人工过码。

> 注：上游对验证码缺失返回的是 `code: -2` + 文案 `CaptchaVerify cannot be empty`，
> 不是逆向代码里猜测的 `code: 11`。`provision.is_captcha_error()` 同时按 code 与文案判定。

---

## 6. 环境坑：NO_PROXY 里的 `[::1]`

本机环境变量 `NO_PROXY=...,::1,[::1]` 会让 httpx 抛：

```
httpx.InvalidURL: Invalid port: ':1]'
  File ".../httpx/_client.py", line 698, in __init__
    URLPattern(key): None
```

修复：`server/config.py` 导入期调用 `_sanitize_no_proxy()`，剔除含 `[`/`]` 的条目。
修复后 `probe_reachable()` 立即返回 `reachable: True`。

---

## 7. WebUI 实机验证（真实链路，非 mock）

浏览器直连 `http://127.0.0.1:8787/`（网关同源托管静态资源），截图确认：

| 视图 | 验证点 | 结果 |
|---|---|---|
| 创作工作台 | 未配 KEY 时明确报 `missing_api_key`，不静默匿名请求 | ✅ |
| 创作工作台 | 填入 KEY 后模型卡显示 **Z-Image · Z-Image-Turbo**（真实 registry） | ✅ |
| 创作工作台 | 比例 chips = `9:16 · 720×1280` / `3:4 · 864×1152` / `1:1 · 1024×1024` / `4:3 · 1152×864` / `16:9 · 1280×720`，与 `registry.json` 逐项一致 | ✅ |
| 创作工作台 | 顶部 `号池 0/0 · 上游 4802ms`（真实探针延迟） | ✅ |
| 创作工作台 | 结果区空态、生成按钮、参考图拖拽区、灵感词 chips 均渲染 | ✅ |
| 管理台·概览 | API KEY 1 · 号池 0/0 · 模型 32/32 · 今日请求 14 · **上游可达（延迟 5878ms）** · 运行时长 10m54s | ✅ |
| 管理台·模型开关 | 32/32，图片 21/21；每行开关 + version_id 徽标 + 仓库路径 + 只读别名 + kind；类型筛选与全部开/关 | ✅ |
| 管理台·号池 | 账号 0/0；刷新 / 批量导入 / 手动添加；空态引导；下方「一键注册补号」含 `邮箱 → sendEmail → captcha → confirm → loginRegister → done` 链路图、数量、邮箱源下拉（Emailnator 真实 Gmail） | ✅ |
| 管理台·设置 | 缺 Token 时**仍然渲染**「WebUI 鉴权与基址」卡片（否则用户无法在界面里填 Token） | ✅ 已修 |
| 主题 | 深色默认、主色 `#624AFF`、Omni 渐变边框、20px/14px 圆角、中英切换 | ✅ |

### 本轮修掉的两个真实缺陷

1. **缺 Token 时设置页不可达**：`renderSettings()` 原本在 `GET /admin/api/settings` 401 时
   直接 `renderErrorCard` 并 `return`，导致「去设置页填入」按钮点进去还是错误页，
   用户永远填不上 Token。改为**先渲染本地鉴权卡片**，服务端设置加载失败只影响那一张卡。
2. **模型别名可编辑但后端不认**：管理台的别名输入框会 `PATCH {alias}`，而
   `registry.set_enabled()` 只处理 `enabled` / `note`，改别名静默无效。改为只读展示 +
   tooltip 说明「别名由后端从仓库名派生」。

### mock 与真实别名一致性

`webui/mock.js::aliasOf()` 改为与 `server/registry.py::_alias_for()` 同规则，并用
`tests/verify_mock_aliases.py` 做机器校验：

```
mock 中出现的模型仓库名: 32  |  命中注册表: 32
  一致: 32   不一致: 0   注册表里没有: 0
```

---

## 8. 本地部署验证

```powershell
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
```

实测输出（关键片段）：

```
=== 1/5 环境检查 ===
  [OK]   Python 3.12.10  (C:\Program Files\Python312\python.exe)
=== 3/5 初始化数据 ===
  [OK]   模型注册表：启用 32 / 共 32（新增 0 条）
=== 4/5 启动服务 ===
  [env] 清理 3 个大小写重复的环境变量：http_proxy, https_proxy, no_proxy
  方式     : WMI（脱离进程树）
  PID      : 21008
  状态     : 已就绪 ✅
=== 5/5 部署验证 ===
  [OK]   WebUI 首页
  [OK]   管理接口
  [OK]   模型注册表
  [OK]   上游可达
```

```powershell
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 status
```
```
civision-gateway 状态
  进程      : 运行中 (PID 22492)
  端口 8787 : 监听中 (PID 22492)
  HTTP      : 200 OK
  版本      : 1.0.0
  上游      : 可达（4046 ms）
  号池      : 可用 0 / 共 0（冷却 0）
  模型      : 启用 32 / 共 32
  请求      : 累计 20，今日 20，失败 20
```

**脱离进程树验证**：服务 PID 的父进程是 WmiPrvSE（不是启动它的 shell）；
`stop` 释放端口后 `Start-ScheduledTask -TaskName civision-gateway` 能重新拉起
（`LastTaskResult = 0`），自启路径可用。

### 部署时暴露并修掉的三个环境问题

| 问题 | 现象 | 修法 |
|---|---|---|
| **PS 5.1 读无 BOM 的 UTF-8 `.ps1`** | 中文注释被按 GBK 解析，报 `Unexpected token '}'` 等一堆语法错 | 所有 `.ps1` 写 **UTF-8 BOM**（`New-Object System.Text.UTF8Encoding($true)`） |
| **环境变量大小写重复** | `Start-Process` 抛 `Item has already been added. Key in dictionary: 'NO_PROXY' Key being added: 'no_proxy'`；`Get-ChildItem env:` 直接枚举失败 | 启动前 `Repair-EnvDuplicates`：按大写分组，只保留大写形式（Windows API 本身大小写不敏感） |
| **子进程随终端一起死** | `Start-Process` 起的 python 是子进程，启动它的 job 一被 kill 服务就没了 | 改用 **WMI `Win32_Process.Create`**（父进程 = WmiPrvSE），PID 由 `server/run.py` 自己写盘 |

另外修了一个**跨客户端互操作**问题：FastAPI 默认只发 `application/json`，
Windows PowerShell 5.1 的 `Invoke-RestMethod` 在缺 `charset` 时按 ISO-8859-1 解码，
所有中文变乱码。`app.py` 改用 `UTF8JSONResponse`（`application/json; charset=utf-8`），
修完后 `civision.ps1 selftest` 的中文步骤名正常显示：

```
端到端自检
  ✅ 上游可达
  ✅ 模型注册表
  ❌ 号池          ← 号池为空属正常，先补号
  ✅ API KEY
```

---

## 9. 补号失败复盘：`未知邮箱源: undefined`

**用户现场**：管理台点「一键注册补号」，任务立刻失败，每个账号都是
`邮箱源初始化失败: 未知邮箱源: undefined`，面板上 `provider=undefined`。

### 根因（前端读错字段名）

`GET /admin/api/mail/providers` 返回的条目字段是 **`name`**：

```python
{"name": "emailnator", "label": "Emailnator (真实 Gmail)", ...}
```

而 `admin.js` 读的是 **`p.id`**：

```js
options: providers.map((p) => ({ value: p.id, ... }))   // p.id === undefined
value: (providers[0] && providers[0].id) || 'emailnator'
```

`undefined` 被塞进 `<option value>` 后字符串化成字面量 `"undefined"`，
随 `POST /admin/api/pool/refill` 发回后端；`start_refill` 里
`provider or config.SETTINGS.mail_provider` 对非空字符串 `"undefined"` 是 truthy，
于是**原样透传**到 `mailbox.get_provider("undefined")` → 报错。

离线兜底列表 `FALLBACK_PROVIDERS` 恰好用的是 `id`，所以 mock 模式看不出来 —— 真实链路才炸。

### 修复（两侧都加固）

| 位置 | 改动 |
|---|---|
| `mailbox.provider_info()` | 条目同时给 `id` 与 `name`，并补 `available`；与其它 admin 列表接口的 `id` 命名保持一致 |
| `mailbox.normalize_name()` | 新增：把 `""` / `"undefined"` / `"null"` / `"none"` / `"nil"` / `"nan"` / `"false"` 归一成空串 |
| `mailbox.get_provider()` | 先归一；报错信息带 `repr()`，避免再出现看不出真假的 `undefined` |
| `provision.start_refill()` | 归一后回退默认源；未知源记 warn 日志 |
| `provision` worker | 之前把**闭包参数** `provider`（可能是空串）传给 `p.run()`，现在统一用已归一/回退的 `job.provider` |
| `admin.js` | `providerKey(p) = p.name \|\| p.id`，并过滤掉 `undefined`/`null` 字面量；提交前再兜一层 `\|\| 'emailnator'` |

### 回归验证

```powershell
# 原样复现用户场景：provider 传字符串 "undefined"
Invoke-RestMethod "$B/admin/api/pool/refill" -Method Post -Headers $Hdr `
  -ContentType application/json -Body '{"count":1,"provider":"undefined","verify":true}'
```
```
job=job_4227d815ce03  provider=emailnator        ← 已回退默认源
[0] running          steps=mailbox>mailbox>mailbox
[1] waiting_captcha  steps=mailbox>mailbox>mailbox>check>sendEmail>captcha
末步: 等待人工完成阿里云验证码（在管理台粘贴 captcha_verify）
```

修完不再是「邮箱源初始化失败」，而是正常跑到验证码闸门。

### 顺带做的全量字段对齐审计

把 WebUI 读取的所有响应字段与后端实际返回逐个比对，又揪出 4 处同类不匹配（都是前端读到了不存在的字段，静默显示 `?` / `0` / `----`）：

| 前端读 | 后端原本返回 | 修法（服务端增量补齐） |
|---|---|---|
| `res.changed`（模型批量开关） | `{ok, models}` | 加 `changed`（实际改动条数） |
| `res.imported`（账号批量导入） | `{items}` | 加 `imported` / `count` |
| `k.last4`（KEY 列表尾部） | `tail` | 加 `last4`（与 `tail` 同值，保留两者） |
| `task.star` / `task.progress` | 只有 `starred` | 加 `star`（别名）与 `progress`（按状态推导）、`elapsed` |

验证输出：

```
models/bulk      changed=3   models.enabled=29   items=32
accounts/import  imported=2  count=2
keys             prefix='sk-civ-41551f'  tail='699b'  last4='699b'  masked='sk-civ-41551f...699b'
logs             total=5  items=5
```

全量冒烟复跑：**34/34 通过**。

---

## 10. 部署挂掉复盘：进程被静默杀死

**用户现场**：服务起了一段时间后彻底不可达，`http://127.0.0.1:8787/` 连不上。

### 现场证据

| 检查项 | 结果 |
|---|---|
| PID 文件里的进程 | 不存在 |
| 8787 端口 | 无监听 |
| `gateway.err.log` | **没有任何 traceback / shutdown 记录**，最后一条是正常的启动横幅 |
| `gateway.log` 最后写入 | `15:02:02`（之后 20 分钟无任何输出） |
| 最后两条访问日志 | `GET /` 与 `GET /admin/api/overview` 都是 200 —— 用户打开管理台后进程就没了 |
| 系统启动时间 | 10/03，**没重启过** |
| 应用程序事件日志 | 无 WER / 崩溃记录 |
| 计划任务运行记录 | 15:00 前后无任务触发 |
| WmiPrvSE（进程父） | 仍然存活 —— 不是 WMI 回收带走的 |

**结论**：无异常退出、无崩溃报告、无审计事件 —— 典型的**外部静默 TerminateProcess**。

### 真正的设计缺陷（比"谁杀的"更重要）

原来的自启任务是 `civision.ps1 start`：

```
Task Scheduler → civision.ps1 start → WMI 创建 python → 脚本立刻退出
                                   ↑ Task Scheduler 认为任务"已完成"
```

**任务瞬间就结束了，Task Scheduler 对 python 没有任何责任** —— 进程死了不会重拉。
`RestartCount 3` 形同虚设。所以任何外部清理都能让它永久躺平。

### 修复：引入监督者

试了两版：

| 方案 | 结果 |
|---|---|
| 主任务前台托管（`run`，任务状态 Running + 失败自动重拉） | 恢复速度对不上；**看门狗一补位，前台实例就因端口被占而退出**，两套机制互相打架 |
| ✅ **看门狗做唯一权威监督者** | 主任务只负责"登录时拉一次"，看门狗每 1 分钟探活并兜底 |

`civision.ps1 watchdog` 的分支处理：

- 端口空闲 → `start`
- **端口被 python 占着但 HTTP 不通** → 判定僵死，先杀再 `start`
- 端口被**非 python** 进程占用 → 不动它，心跳记 `FOREIGN`（避免误杀无关服务）

心跳落盘 `server\data\watchdog.heartbeat`，每次一行：

```
2026-10-13T15:38:44  OK pid=2108
2026-10-13T15:34:22  FOREIGN pid=7292
2026-10-13T15:32:24  RESTARTED pid=28764
```

### 破坏性验证（都实测过）

| 场景 | 操作 | 结果 |
|---|---|---|
| **进程被杀** | `Stop-Process -Force` 杀 python | 看门狗 **54.5 秒**拉回（新 PID 28764），心跳 `RESTARTED`，`LastTaskResult=0` |
| **进程僵死** | 假 python 脚本占住 8787 但不响应 HTTP | 看门狗输出 `判定僵死，杀掉重拉` → 新 PID 44684 → `GET /` 200 ✅ |
| 端口被外人占 | 重启间隙瞬时进程占端口 | 记 `FOREIGN` 不动它；下一周期恢复 `OK pid=2108` |

### 部署脚本同步调整

- `deploy.ps1` **默认注册自启 + 看门狗**（`-NoAutostart` 可跳过）；部署完即自愈
- `install-autostart.ps1` 支持 `-NoWatchdog` / `-WatchdogMinutes N`
- 修掉一个计划任务注册坑：`-RepetitionDuration [TimeSpan]::MaxValue` 会生成
  `Duration:P99999999DT23H59M59S` → `The task XML contains a value which is incorrectly
  formatted or out of range`；改用 `[TimeSpan]::FromDays(3650)`

复跑部署脚本（幂等）：5 步全绿，冒烟 **34/34 通过**。

---

## 11. 干掉「DevTools 抠 captcha_verify」：浏览器托管

**用户反馈**：`captcha_verify` 要从 F12 里复制，搞不懂。

### 方案调研

| 方案 | 可行性 | 结论 |
|---|---|---|
| 书签脚本读 `document.cookie` | ❌ 会话 Cookie 是 **HttpOnly**，JS 读不到 | 弃 |
| Chrome 扩展 `chrome.cookies` | ✅ 能读 HttpOnly | 要装扩展 + 开发者模式，步骤仍多；留作后备 |
| **Playwright 驱动系统 Edge** | ✅ 本机已装 Playwright 1.62 + Edge；网关在 **Session 1**（有桌面） | **采用** |
| 手写 CDP over WebSocket | ✅ `websockets 17.1` 可用 | 不必要，Playwright 更省事 |

关键前提实测：网关进程 `SessionId = 1`（交互式），所以 WMI 拉起的进程**能弹出可见窗口**；
`launch_persistent_context(channel="msedge")` 能直接用系统 Edge，无需下载浏览器。

### 交付的三条路

1. **浏览器托管 → 抓取会话**（最省事）：用户在托管窗口里正常登录，点一下就入库。
2. **托管注册**：自动建邮箱 + DOM 注入预填；用户只点「注册」+ 拖一次滑块，
   网关**自动接住** `captcha_verify` 并回填给等待中的任务。
3. **手动粘贴**（兜底）：保留，但粘贴做容错归一化。

### 自动接住 token 的实现

`server/browser.py::_on_request` 挂在 `page.on("request")` 上：

- 只匹配 URL 含 `/api/v1/auth/` 的请求（避免误抓）
- 用正则从 body 里抠 `captcha_verify` / `captchaVerify` / `captchaToken` / `captcha_token`
- 命中后调 `_feed_waiting_jobs(token)`：遍历 `provision.JOBS`，
  给所有 `status == "waiting_captcha"` 的任务 `supply_captcha(token)`
- 任务里的 `threading.Event` 被 set，从阻塞中醒来继续跑

Playwright 的 sync API 必须在固定线程用，所以 `browser.py` 起了**专属 worker 线程 + 命令队列**
（`_Worker.call(cmd, **args)`），FastAPI 侧照常写同步代码。

### 实测证据

| 验证项 | 结果 |
|---|---|
| 托管浏览器启动 | ✅ 可见 Edge 打开 `https://modelscope.ai/home`，`state=running`，20 个请求 |
| Cookie 抓取 | ✅ 读到 6 个 Cookie（含 HttpOnly `acw_tc`/`ssxmod_itna`）；未登录正确判 `healthy=false`（`access forbidden`） |
| 嗅探器 | ✅ 合成请求 → `{"url":"…/auth/__probe","length":32,"email":"probe@test"}` |
| **自动回填** | ✅ 任务日志：`[captcha] 已收到 captcha_verify（32 字符）`，状态 `waiting_captcha → running`，继续跑 `sendEmail` |
| token 归一化 | ✅ `captcha_verify=ABC123` / `"ABC123"` / `{"captcha_verify":"ABC123"}` → `ABC123` |
| WebUI | ✅ 号池页「浏览器托管」卡片 + 过码弹框（托管优先 + 手动兜底）渲染正常 |
| 冒烟回归 | ✅ 34/34 |

> 合成测试用的 token 是假的，所以上游回 `code=-1 system error` —— 这恰好证明
> 请求真的发出去了、链路真的接上了。

新增接口：`/admin/api/browser/{status,launch,goto,close,register,register/{sid}}`、
`/admin/api/accounts/from-browser`、`/admin/api/pool/refill/browser`。

---

## 12. 尚未定稿（需要真实账号才能收口）

| 项 | 现状 | 收口方式 |
|---|---|---|
| Agent 模式 SSE 事件内部结构 | 已知事件名（`thought` / `image_generation_started` / `image_generation_result` / `error`），`content` 内层字段未实测 | 用真实账号跑一次 agent 会话，抓 SSE 原文 |
| 视频生成是同步返回还是 `task_id` 轮询 | 网关两种都兼容（`extract_status` + 轮询 `tasks/status`） | 真实账号跑一次 |
| `/openapi/*` 是否接受 Access Token 替代 Cookie | 网关同时支持 Cookie 与 `Bearer` 两种注入 | 用 `/my/myaccesstoken` 取 Token 实测 |
| 阿里云验证码自动化通过率 | 依赖 IP 风控档位；网关提供人工过码 + 浏览器托管两条路 | 多档位压测 |
| boomlify 游客地址构成 | `POST /guest/emails/create {domainId}` 已通，返回体不含地址；地址由 `${username}@${domain}` 拼装 | 用浏览器会话跑一次确认 |
| temp.tf 收件接口 | `/api/check` 存在但 403 风控；`/api/inbox/{addr}` 未验证 | 浏览器会话 + 抓包 |
