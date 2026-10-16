# Civision Gateway WebUI

纯前端单页应用（**零外部依赖、零构建步骤**）：原生 ES module + 原生 CSS，
由后端 FastAPI 进程同源托管静态资源（`/` 无需鉴权）。

```
webui/
├── index.html      单页外壳：SVG 图标精灵、顶栏、两个视图挂载点
├── theme.css       主题令牌 --ms-*（54 个，逆向自源站 ui-tokens，本文件不改动）
├── app.css         布局与组件（只消费 --ms-*，不重新定义）
├── app.js          路由 / i18n / localStorage / API 封装 / 通用组件
├── studio.js       创作工作台（图片 / 视频 / 音乐）
├── admin.js        管理台（概览 / KEY / 号池 / 模型 / 设置 / 日志）
├── mock.js         演示模式：拦截 fetch，返回 API.md 结构的离线假数据
└── README.md       本文件
```

## 打开方式

**A. 后端托管（真实链路）** —— 启动网关后浏览器打开
`http://127.0.0.1:<port>/`，或在仓库里直接看前端：

```powershell
python -m http.server 8791 --directory D:\DSH\civision-gateway\webui
# 浏览器：http://127.0.0.1:8791/index.html
```

静态服务器只提供文件，不提供 API；此时页面顶栏会提示未配置 KEY。

**B. 演示模式（离线自检，无需后端）**

```
http://127.0.0.1:8791/index.html?mock=1#/studio
http://127.0.0.1:8791/index.html?mock=1#/admin
```

`?mock=1` 时 `mock.js` 覆盖 `window.fetch`，命中 `/studio/*`、`/admin/*`、`/v1/*`
的请求全部返回 `docs/API.md` 里定义结构的假数据（含任务轮询进度、补号时间线、
一次性 KEY 明文、日志、自检）。所有网络请求都不出浏览器。

演示数据说明：

- 模型目录从 `server/data/registry.json` 抽取（**21 图片 / 8 视频 / 3 音频**，
  含真实 `sizes`、`default_params`、`version_id`、`model`），
  别名与 `GET /v1/models` 一致（`z-image-turbo`、`wan2-2-i2v-a14b` …）。
- 出图结果是内联 SVG `data:` URI，离线可渲染；演示模式没有真实视频/音频，卡片显示占位帧。
- 默认关掉 `stable-diffusion-v1-5` 与 `minimax-music3`，用来检验置灰与开关状态。
- 调试参数：`?mock=1&mock_error=1` 随机让 1/3 的 admin 请求返回 502（检查错误态）；
  控制台 `__civisionMock.failNext(3)` 让接下来 3 个请求失败。

## 与后端的关系

| 面 | 前缀 | 鉴权头 | 存储 |
|---|---|---|---|
| OpenAI 兼容面 | `/v1/*` | `Authorization: Bearer <API_KEY>` | — |
| Studio 面 | `/studio/api/*` | `Authorization: Bearer <API_KEY>` | `localStorage['civision.apikey']` |
| Admin 面 | `/admin/api/*` | `X-Admin-Token: <token>` | `localStorage['civision.admin.token']` |

- API 基址默认同源（空字符串），可在「管理 → 设置 → WebUI 鉴权与基址」里覆盖为
  `http://host:port`（`localStorage['civision.base']`）。
- KEY / Token 未配置时顶栏出现提示横幅；Studio 面缺 KEY 会直接报错而不是静默匿名请求
  （演示模式除外）。
- 错误按 `docs/API.md` 第 4 节统一解析：`{error:{message,type,code,upstream_status,request_id}}`，
  非 2xx 一律抛出 `ApiError`，由 toast 或就地错误态展示。

## 界面约定

- **深色为默认**（`data-theme="dark"`），右上角月亮/太阳图标切换浅色，选择存 `localStorage`。
- 全部文案中英双语，右上角 `中/EN` 切换（`localStorage['civision.lang']`，默认中文）。
- 路由：`#/studio`、`#/admin/<tab>`（`#/admin/keys` `#/admin/pool` `#/admin/models`
  `#/admin/settings` `#/admin/logs`）。切 Tab 用 `history.replaceState`，不重挂载视图。
- 主题令牌全部来自 `theme.css` 的 `--ms-*`（主色 `#624AFF` / hover `#533FD9` / press `#4534B2`；
  背景 `#000` → `#1A1A1A` → `#262626`；边框 `--ms-color-border-tertiary`）。
- Omni 渐变边框：`linear-gradient(90deg, omni-border-start, -mid, -end)`，
  输入面板圆角 `20px`，视频容器与参数折叠面板 `14px`。
- 图标全部为内联 SVG（`index.html` 顶部的 `<symbol>` 精灵），无 emoji、无 CDN。
- 无障碍与质感：真实 `:hover` / `:active` / `:focus-visible`，模态框焦点陷阱 + Esc，
  `prefers-reduced-motion` 全局降级，骨架屏固定占位避免布局跳动。

## Studio 参数映射

| UI 字段 | 请求字段 | 默认来源 |
|---|---|---|
| 数量 | `quantity` | `default_params.basicDiffusionArgs.numImagesPerPrompt` → `defaults.image_request` |
| 步数 | `steps` | `numInferenceSteps` |
| 引导强度 | `guidance_scale` | `guidanceScale` |
| 采样器 | `sampler` | 模型的 `support_sampler[0].value` |
| 种子 | `seed` | `seed`（-1 = 随机） |
| 负面提示词 | `negative_prompt` | `defaults.*_request.promptArgs.negativePrompt` |
| 重绘幅度 | `strength` | `defaults.image_request.imageInputFrontArgs.strength`，仅带参考图时下发 |
| 比例 | `width`/`height` | 模型 `sizes`（形如 `3:4 · 1104×1472`） |
| 视频时长 | `total_seconds` | `default_params.totalSeconds` |
| 参考图 | `image` + `references[].url` | 本地上传（`URL.createObjectURL`）或粘贴 URL |

生成流程：`POST /studio/api/generate` → 轮询 `GET /studio/api/tasks/{id}`
（1.5s 起，×1.35 指数退避，上限 5s，404 立即停止）→ 完成后 `GET /studio/api/gallery?limit=60&kind=`。

## 已知缺口

1. **参考图上传的降级路径**：`POST /studio/api/uploads` 已实现（上游 OSS 三段式
   `/v1/rm/uploadUrl` → `PUT <UploadUrl>` → `/v1/rm/downloadUrl` + `/api/v1/image/create` 落库）。
   但**号池为空时网关只能本地落盘**，返回 `upstream:false` 与 `local_url`；此时参考图
   只存在本机，上游生成拿不到。界面会弹「仅本地落盘」警告并把 `note` 显示出来。
   要打通真实图生图，先在管理台加号或一键补号。
2. **音乐参数已下发**：`bpm / sample_rate / key_scale / time_signature / vocal_language / lyrics`
   都已进入 `POST /studio/api/generate` 契约并透传到上游 `basic_diffusion_args`。
   可选值取自模型 `allowed`，范围取自 `limits`。
   注意：**上游音频链路是结构同构推断**（未在公开 chunk 里找到独立 fetch 调用），
   见 `docs/PROTOCOL.md` §8，可能需要按真实账号实测微调字段名。
3. **Agent 模式已接真实路由**：`POST /studio/api/agent/generate`（网关侧创建会话 +
   消费 SSE），不再是占位。但上游 SSE 事件的 `content` 内层结构尚未实测，
   网关用宽松递归抽产物；若真实返回结构与预期不符，任务会以「SSE 未返回产物」失败。
4. **模型别名不可改**：管理台只做启用/停用（`PATCH /admin/api/models/{alias}` 接受 `note`）。
   别名由 `server/registry.py::_alias_for` 从仓库名派生，改别名需要改代码 + 重启。
   `webui/mock.js::aliasOf` 已与后端规则逐字对齐，`tests/verify_mock_aliases.py` 可校验。
5. **`total_seconds` / `steps` 范围**：非音频模型的上游 `limits` 在注册表里没有记录，
   界面用通用兜底区间（步数 1–100、CFG 0–20、时长 1–600），不一定等于上游真实限制。
6. `theme.css` 按约定未改动；如需覆盖样式请新建 `theme-override.css` 并在 `index.html` 里
   追加 `<link>`（当前没有该文件）。
