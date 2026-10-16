# civision-gateway API 契约

三套接口，共用同一个 FastAPI 进程与 SQLite 存储。

- **OpenAI 兼容面** `/v1/*` —— 给第三方客户端（OpenAI SDK / Cherry Studio / NextChat / 各种绘图前端）
- **Studio 面** `/studio/api/*` —— 给本项目创作工作台
- **Admin 面** `/admin/api/*` —— 给本项目管理台（API KEY / 号池 / 模型开关）

鉴权：`Authorization: Bearer <API_KEY>`（`/v1/*` 与 `/studio/api/*`）；
`/admin/api/*` 用 `X-Admin-Token`（首次启动打印到控制台，存在 `data/admin.token`）。
WebUI 静态资源 `/` 无需鉴权。

---

## 1. OpenAI 兼容面

### `GET /v1/models`

```json
{ "object": "list", "data": [
  { "id": "z-image-turbo", "object": "model", "created": 1730000000,
    "owned_by": "civision",
    "meta": { "kind": "image", "sd_version": "Z_IMAGE_TURBO",
              "sub_version": "Z_IMAGE_TURBO", "version_id": 692,
              "model": "Tongyi-MAI/Z-Image-Turbo", "enabled": true,
              "sizes": [{"label":"1:1","width":1328,"height":1328}] } }
] }
```

只返回**已启用**的模型。`id` 为网关别名（小写连字符），也接受 `sd_version` / `sub_version` / `model` 原值查询。

### `POST /v1/images/generations`

OpenAI Images API 兼容 + 扩展字段。

```json
{
  "model": "z-image-turbo",
  "prompt": "a cat on the moon",
  "n": 1,
  "size": "1104x1472",
  "response_format": "url",

  "negative_prompt": "",
  "seed": -1,
  "steps": 30,
  "guidance_scale": 4,
  "sampler": "Euler",
  "image": "https://.../ref.png",
  "strength": 0.7,
  "lora": [{ "model_version_id": 123, "weight": 1.0 }],
  "mode": "custom"
}
```

响应（`response_format=url`）：

```json
{ "created": 1730000000, "data": [ { "url": "https://.../out.png", "revised_prompt": "..." } ] }
```

`response_format=b64_json` → `{"b64_json": "..."}`。
上游异步时，网关**同步阻塞等待**（默认 180s，`timeout` 可调），超时返回 `504`。

### `POST /v1/videos/generations`

```json
{ "model": "wan2-2-i2v-a14b", "prompt": "...", "size": "480x848",
  "seconds": 5, "image": "https://.../first.png", "seed": -1, "steps": 50, "guidance_scale": 5 }
```

```json
{ "id": "vid_xxx", "object": "video", "status": "queued|processing|succeeded|failed",
  "created": 1730000000, "model": "wan2-2-i2v-a14b", "data": [ { "url": "..." } ],
  "error": null }
```

### `GET /v1/videos/{id}` / `GET /v1/tasks/{id}`

轮询任务。`GET /v1/tasks/{id}` 返回统一任务视图（含 `kind`、`upstream`、`attempts`）。

### `POST /v1/chat/completions`

多模态入口：`messages` 里带 `image_url` → 图生图 / 图生视频；
`model` 指向视频模型且 `stream=false` 时走视频链路；
`modalities: ["image"]` 显式声明。

```json
{ "model": "z-image-turbo", "messages": [{"role":"user","content":"a cat"}],
  "modalities": ["image"] }
```

---

## 2. Studio 面

### `GET /studio/api/catalog`

```json
{
  "image": [ { "alias":"z-image-turbo", "label":"Z-Image", "sub_label":"Z-Image-Turbo",
               "sd_version":"Z_IMAGE_TURBO", "sub_version":"Z_IMAGE_TURBO",
               "version_id":692, "model":"Tongyi-MAI/Z-Image-Turbo",
               "sizes":[{"label":"1:1","width":1328,"height":1328,"value":0}],
               "default_params": {...}, "enabled": true } ],
  "video": [ ... ],
  "audio": [ ... ],
  "defaults": { "image":"z-image-turbo", "video":"wan2-2-i2v-a14b",
                "image_request": {...}, "video_request": {...} },
  "ratios": { "image": [...], "video": [...] },
  "style_tags": [ {"name":"Photography","tag":"photography","svg":"..."} ],
  "loras": [ ... ]
}
```

### `POST /studio/api/generate`

```json
{ "kind": "image|video|audio", "model": "z-image-turbo", "mode": "custom|agent",
  "prompt": "...", "negative_prompt": "", "width": 1104, "height": 1472,
  "quantity": 1, "seed": -1, "steps": 30, "guidance_scale": 4, "sampler": "Euler",
  "total_seconds": 5, "image": "url", "strength": 0.7,
  "references": [ {"type":"IMAGE","url":"..."} ],
  "lora": [ {"model_version_id":123} ],

  "lyrics": "", "bpm": 128, "duration": 160, "audio_count": 1,
  "sample_rate": 48000, "key_scale": "C major", "time_signature": "4",
  "vocal_language": "en" }
```

→ `{ "task_id": "tsk_xxx", "status": "queued" }`

音乐字段（`kind=audio`）透传到上游 `basic_diffusion_args` 的
`lyrics / bpm / duration / audioCount / sampleRate / keyScale / timeSignature / vocalLanguage`。

### `POST /studio/api/agent/generate`

Agent 模式：网关侧创建会话 + 消费 SSE，落成普通任务供轮询。

```json
{ "model": "z-image-turbo", "prompt": "...", "width": 1024, "height": 1024,
  "references": [ {"type":"IMAGE","url":"..."} ] }
```
→ `{ "task_id": "tsk_xxx", "status": "queued", "mode": "agent", "model": "..." }`

### `POST /studio/api/uploads`

参考图 / 参考视频上传。两种入参：

- `multipart/form-data`：字段 `file`（必填）、`type`（OSS Type，可选）、`kind=image|video`
- `application/json`：`{"filename":"a.png","data_url":"data:image/png;base64,...","type":"AIGC_MUSE_IMG"}`

```json
{ "filename":"a.png", "size":10240, "content_type":"image/png",
  "oss_type":"AIGC_MUSE_IMG", "url":"https://.../a.png",
  "local_url":"/studio/uploads/ab12cd34_a.png",
  "file_url":"https://...", "media_id":123, "upstream": true }
```

上游走三段式（`/v1/rm/uploadUrl` → `PUT <UploadUrl>` → `/v1/rm/downloadUrl`），
成功后尝试登记到 AIGC 媒体库拿 `media_id`。
**号池无可用账号时降级为本地落盘**，返回 `local_url`（`upstream:false` + `note`）。

### `GET /studio/uploads/{name}`

本地落盘文件（仅本机可访问），无需鉴权。

### `GET /studio/api/tasks/{task_id}`

```json
{ "task_id":"tsk_xxx", "kind":"image", "status":"succeeded",
  "created":1730000000, "finished":1730000060, "model":"z-image-turbo",
  "prompt":"...", "params":{...}, "account":"a***@gmail.com",
  "outputs":[{"type":"image","url":"...","width":1104,"height":1472}],
  "error":null }
```

### `GET /studio/api/gallery?limit=60&kind=image&star=0`

→ `{ "items":[ <task 视图> ] }`

### `POST /studio/api/gallery/{task_id}/star` · `POST /studio/api/tasks/{task_id}/star`

```json
{ "starred": true }
```
→ `{ "task_id":"tsk_xxx", "starred": true }`

### `GET /studio/api/health`

→ 号池 + 上游可达性摘要。

---

## 3. Admin 面

### 总览

```
GET /admin/api/overview
```
```json
{ "version":"1.0.0", "uptime":1234,
  "keys": {"total":3,"enabled":3},
  "pool": {"total":5,"healthy":4,"cooldown":1},
  "models": {"total":32,"enabled":28},
  "requests": {"total":812,"today":120,"failed":7},
  "upstream": {"reachable":true,"latency_ms":180} }
```

### API KEY

```
GET    /admin/api/keys
POST   /admin/api/keys            {"name":"cherry","note":"","models":["*"],"rpm":60,"quota":0}
GET    /admin/api/keys/{id}
PATCH  /admin/api/keys/{id}       {"name","enabled","models","rpm","quota","note"}
DELETE /admin/api/keys/{id}
POST   /admin/api/keys/{id}/reset   # 重置用量
```

KEY 明文形如 `sk-civ-<32hex>`，服务端只存 `sha256` 前缀 + 末 4 位；**创建时返回一次明文**。

### 号池

```
GET    /admin/api/accounts
POST   /admin/api/accounts              {"cookie":"...","label":"手工号","note":""}
POST   /admin/api/accounts/{id}/check   # 刷新登录态 + 额度
POST   /admin/api/accounts/{id}/enable  {"enabled":true}
DELETE /admin/api/accounts/{id}
POST   /admin/api/accounts/import       {"text":"cookie1\ncookie2", "label":"批量"}
```

账号视图：
```json
{ "id":"acc_1","label":"a***@gmail.com","email":"a@gmail.com","enabled":true,
  "healthy":true,"cooldown_sec":0,"requests":42,"failures":1,
  "quota":{"image":100,"video":10,"balance":1234},
  "last_error":"","created":1730000000 }
```

### 一键注册补号

```
GET    /admin/api/mail/providers
POST   /admin/api/pool/refill        {"count":2,"provider":"emailnator","verify":true,"captcha":"<可选>"}
GET    /admin/api/pool/refill/{job}  # 轮询任务进度
POST   /admin/api/pool/refill/{job}/captcha  {"captcha_verify":"..."}   # 人工过码回填
```

`refill` 任务视图：
```json
{ "job":"job_xxx","status":"running|waiting_captcha|done|failed",
  "target":2,"done":1,"provider":"emailnator",
  "steps":[{"email":"x@googlemail.com","stage":"mailbox|sendEmail|captcha|confirm|loginRegister|done|failed",
            "message":"...","at":1730000000}],
  "need_captcha":{"email":"x@googlemail.com","scene_id":"49006ysb","prefix":"18o9k0"},
  "accounts":[{"id":"acc_9","email":"x@googlemail.com"}] }
```

### 模型开关

```
GET   /admin/api/models                 # 全量注册表 + enabled 状态 + 别名
PATCH /admin/api/models/{alias}         {"enabled":false,"alias":"...","note":"..."}
POST  /admin/api/models/bulk            {"enabled":true,"kind":"image","except":["..."]}
```

### 设置 / 日志

```
GET  /admin/api/settings
PUT  /admin/api/settings    {"upstream_base":"https://modelscope.ai","timeout":180,
                             "pool_size":3,"cooldown":90,"strict_model":true,
                             "auto_refill":false,"mail_provider":"emailnator",
                             "proxy":"","default_kind":"image"}
GET  /admin/api/logs?limit=200&level=error
POST /admin/api/selftest    # 端到端自检：上游可达 / 号池可用 / 模型目录 / 一次真实出图
```

---

## 4. 错误模型

统一：
```json
{ "error": { "message":"...", "type":"upstream_error", "code":"InvalidAuthentication",
             "upstream_status":401, "request_id":"..." } }
```

| HTTP | type | 触发 |
|---|---|---|
| 400 | `invalid_request_error` | 参数不合法 |
| 401 | `invalid_api_key` / `InvalidAuthentication` | 网关 KEY 无效 / 上游登录态失效 |
| 402 | `insufficient_quota` | 上游额度不足 |
| 404 | `model_not_found` | 模型不存在或未启用 |
| 409 | `model_downgraded` | strict 模式下上游降级 |
| 429 | `rate_limit_exceeded` | 号池冷却 / 上游限流 |
| 502 | `upstream_error` | 上游 5xx |
| 504 | `upstream_timeout` | 生成超时 |
