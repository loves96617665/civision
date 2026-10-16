# Civision 上游协议逆向报告

> 目标：`https://modelscope.ai/civision`
> 方法：前端 chunk 静态逆向（205 个 asset）+ 无凭证动态探测 + 主题令牌提取
> 证据文件：`D:\DSH\recon\civision\`（assets / probe_api.json / registry.json / theme-tokens.json）

---

## 0. 站点架构

| 项 | 值 |
|---|---|
| 框架 | React Router v7（`window.__reactRouterManifest`）+ 阿里 griffel/createStyles |
| 前端 CDN | `//cdn-ai.modelscope.cn/static/assets/*.js` |
| 站点模式 | `window.__SITE_MODE__` = `INTERNATIONAL` \| `COMMON` |
| 站点域名 | `modelscope.ai`（国际）/ `modelscope.cn`（国内） |
| 关键路由 | `/civision`（首页）、`/civision/image-generation`、`/civision/video-generation`、`/aigc/*` |
| 埋点 | 阿里 aplus（`sg.mmstat.com`），非阻塞 |

**两条 API 通道（重要）**

| 通道 | 前缀 | 认证 | 用途 |
|---|---|---|---|
| 站内通道 | `https://modelscope.ai/api` | Cookie 会话（`credentials: include`） | agentic 会话、图片生成、图库、用户 |
| OpenAPI 通道 | `https://modelscope.ai/openapi` | Cookie 会话 **或** Access Token | 视频生成、额度估算、BYOK、魔方余额 |

> 前端 axios 实例 baseURL = `origin + '/api'`；`/openapi/*` 是绝对路径直连。
> 两个通道的**错误结构不同**：
> - `/api/*` → `{"Code": 10010101003, "Message": "user not logged in", "RequestId": "...", "Success": false}`
> - `/openapi/*` → `{"success": false, "request_id": "...", "code": "InvalidAuthentication", "message": "Invalid authentication: user not logged in"}`

---

## 1. 模型目录（公开，无需登录）

```
GET /api/v1/muse/predict/unauth/defaultTemplateV2     # 200, 42KB
```

返回 `Data.data.{IMAGE,VIDEO,AUDIO}.supportSDVersionList`，每项字段：

| 字段 | 说明 |
|---|---|
| `value` | SD 版本枚举（如 `Z_IMAGE_TURBO`、`QWEN_IMAGE_20_B`） |
| `sub_value` | 子版本枚举（真正选中的模型，如 `Z_IMAGE_TURBO`） |
| `label` / `sub_label` | 展示名 |
| `versionId` | 版本 ID（视频生成用 `checkpoint_model_version_id`） |
| `modelUrl` | `modelscope://Owner/Repo?revision=master` → **`model_args.model` 取 `Owner/Repo`** |
| `defaultParams` | 默认推理参数 |
| `imageSizeSlider` | 比例档位 `[{label,width,height,value}]` |
| `videoSizeSlider` | `{large:[...], small:[...]}` |
| `supportSampler` / `limits` / `allowed` / `maxPicSize` | 参数约束 |

前端映射函数（`usePendingSubmit` chunk）：

```js
{ label, subLabel, sdVersion: value, subVersion: sub_value,
  versionId: Number(versionId)||0, model: modelscope://Owner/Repo → "Owner/Repo",
  supportType, sizeSlider, defaultParams }
```

**已抓取清单：图片 21 / 视频 8 / 音频 3**，完整表见 `registry.json`。

图片默认：`Z_IMAGE` → `Tongyi-MAI/Z-Image-Turbo`，`1104×1472`，`guidanceScale 4`，`steps 30`，`sampler Euler`。
视频默认：`WAN_VIDEO_2_2_I2V_A_14_B` → `Wan-AI/Wan2.2-I2V-A14B-BF16`，`480×848`，`guidanceScale 5`，`steps 50`，`totalSeconds 5`。

---

## 2. 图片生成

### 2.1 自定义模式（同步 JSON 返回）

```
POST /api/v1/aigc/agentic/image/generate
Content-Type: application/json
Cookie: <会话>
```

请求体：

```json
{
  "type": "IMAGE",
  "mode": "custom",
  "predict_task_request": {
    "predict_type": "TXT_2_IMG",
    "prompt_args": { "prompt": "a cat" },
    "basic_diffusion_args": {
      "width": 1104, "height": 1472, "num_images_per_prompt": 1
    },
    "model_args": {
      "model": "Tongyi-MAI/Z-Image-Turbo",
      "lora_args": [{ "model_version_id": 123 }]
    }
  }
}
```

图生图（`predict_type = "IMG_2_IMG"`）追加：

```json
"image_input_front_args": { "image": "https://.../xxx.png", "strength": 1 }
```

> 字段名转换：前端把 `defaultParams.basicDiffusionArgs` 的驼峰键转成下划线（`numInferenceSteps → num_inference_steps`），
> 但**请求体里用的是下划线**；`num_images_per_prompt` 对应前端的 `numImagesPerPrompt`。

### 2.2 Agent 模式（会话 + SSE 流）

```
POST /api/v1/aigc/agentic/conversations                    # {title} -> 会话
POST /api/v1/aigc/agentic/conversations/{uuid}/generate    # SSE 流
POST /api/v1/aigc/agentic/conversations/{uuid}/stop        # 停止
GET  /api/v1/aigc/agentic/conversations?page=1&page_size=20
GET  /api/v1/aigc/agentic/conversations/{uuid}
GET  /api/v1/aigc/agentic/messages/{message_id}
GET  /api/v1/aigc/agentic/messages/{message_id}/tasks/status
```

`/generate` 请求体：`{"prompt": "...", "images": [...], "image_ratio": {...}}`，
请求头 `x-no-compression: 1`，响应 `text/event-stream`。

**SSE 事件类型**：`thought`、`off_topic_response`、`aigc_agentic_result`、
`image_generation_started`、`image_generation_result`、`error`。
解析规则：按 `\n` 切行 → 去掉 `data:` 前缀 → JSON。

### 2.3 任务与产物结构

```jsonc
{
  "status": "SUCCEED | FAILED | CANCELLED | RUNNING",
  "task_type": "TXT_2_IMG | IMG_2_IMG | IMAGE_TO_VIDEO | TXT_2_VIDEO",
  "media_type": "image | video",
  "output_images": [{ "url": "..." }],
  "output_videos": [{ "url": "...", "video_id": "..." }],
  "task_output": { "output_images": [...], "output_videos": [...] },
  "image_id": "...",
  "lora_info": { "base_model": "..." }
}
```

历史消息 content 类型：`aigc_agentic_input`、`aigc_custom_input`、`aigc_video_input`、
`aigc_image_generation_result`、`aigc_video_generation_result`、`error`。

---

## 3. 视频生成

```
POST /openapi/v1/aigc/agentic/video/generate
Content-Type: application/json
Cookie: <会话>
```

请求体：

```json
{
  "type": "VIDEO",
  "mode": "custom",
  "video_predict_task_request": {
    "predict_type": "TXT_2_VIDEO",
    "prompt_args": { "prompt": "..." },
    "basic_diffusion_args": {
      "guidanceScale": 5, "height": 848, "width": 480,
      "numInferenceSteps": 50, "seed": -1, "total_seconds": 5
    },
    "model_args": {
      "checkpoint_model_version_id": 647,
      "lora_args": []
    }
  }
}
```

> ⚠️ 视频体的 `basic_diffusion_args` **保留驼峰**（直接展开 `defaultParams.basicDiffusionArgs`），
> 仅 `total_seconds` / `width` / `height` 由 UI 覆盖；`predict_type` 由 `TXT_2_VIDEO` / `IMG_2_VIDEO` 决定。

参考图（图生视频 / 首尾帧）走 `image_input_front_args`，
多模态参考走 `video_inference_args: { mode: "REF2VA", accelerateLora, references: [...] }`；
`references[]` 元素：`{type:"IMAGE"|"VIDEO"|"AUDIO", image|video|audio: url, image_id?}`。

错误码：`InvalidAuthentication`、`InputParameterError`、`ResourceNotFound`。

---

## 4. 额度 / 计费

```
POST /openapi/v1/aigc/agentic/estimate-quota   # {type:"IMAGE"|"VIDEO"} -> {success, data:{quota:number}}
GET  /openapi/v1/magicubes/balance             # -> {total_balance, available_balance}
GET  /openapi/v1/magicubes/earn/rules
GET  /openapi/v1/magicubes/spend/rates?...
GET  /openapi/v1/magicubes/transactions?type=&category_key=&page=&page_size=
GET  /openapi/v1/byok/models                   # 自带 key 的模型列表
GET  /api/v1/inference/rate-limit              # {currentUsagePer5Seconds, currentUsagePerDay, requestLimitPer5Seconds, requestLimitPerDay}
```

---

## 5. 媒体资源（上传 / 落库）

### 5.1 OSS 三段式上传（完整逆向）

逆向自 `upload-D1d0Zjeu.js` + `common-15R4c2zf.js` + `ossType-vMUbgUmS.js`。

```
① POST /api/v1/rm/uploadUrl
   body: { "FileName": "a.png", "Type": "AIGC_MUSE_IMG", "ContentType": "image/png" }
   -> { Code:200, Success:true, Data:{ "UploadUrl": "https://...oss...?sign", "Callback": "<base64>" } }

② PUT <UploadUrl>          # 直传 OSS，body = 文件字节
   headers: { "Content-Type": <ct>, "x-oss-meta-author": "aliy", ["x-oss-callback": <Callback>] }
   ⚠️ 前端有 OSS 域名白名单校验（https + *.aliyuncs.com），非白名单直接拒绝

③ POST /api/v1/rm/downloadUrl
   body: { "FileUrl": "<UploadUrl 去掉 ? 后面的签名>", "Type": "AIGC_MUSE_IMG" }
   -> { Code:200, Success:true, Data:{ "DownloadUrl": "https://..." } }
```

`Type` 取值（`ossType` 枚举，共 30 个）：
`DEMO` `STUDIO` `ACTIVE_IMAGE` `COMMENT_PICTURE` `STUDIO_COVER` `RACE_SCRIPT` `RACE_RESULT`
`RACE_IMAGE` `RACE_LEAERBOARD` `RACE_LEADERBOARD` `AVATAR` `TOOL_BOX_README` `OPERATION_VIDEO`
`THEME_IMAGE` `THEME_VIDEO` `ACTIVE_TEXT` `AIGC_COVER_IMAGE` `AIGC_COVER_VIDEO` `WORKFLOW_IMAGE`
`AIGC_TRAIN_IMG` `COLLECTION_IMAGE` `AIGC_MUSE_IMG` `AGENT_TOOL` `AIGC_MUSE_IMG_PRIVATEZONE`
`MCP_SERVER_COVER` `AGENT_CHAT` `MODEL_COVER` `DATASET_COVER` `AIGC_TAG_IMAGE` `AIGC_SEARCH_IMG`

前端默认：图片用 `AIGC_COVER_IMAGE`，视频用 `AIGC_COVER_VIDEO`。

### 5.2 落库到 AIGC 媒体库

```
POST /api/v1/image/create
body: { "data": [ { "height":1024, "index":0, "sourceType":"MUSE_UPLOAD",
                    "url":"<DownloadUrl>", "width":1024, "mediaType":"image",
                    "coverUrl":"..." } ] }
-> { "success": true, "data": [ { "id": 123, "url": "...", "displayUrl": "...", "coverUrl": "..." } ] }
```

拿到 `id` 后即可作为 `image_input_front_args.image` 或 `references[].image_id` 使用。

### 5.3 其它媒体接口

```
GET  /api/v1/image/get
POST /api/v1/image/delete
GET  /api/v1/image/getTags
POST /api/v1/image/updateImageGenerateInfo
POST /api/v1/predict/getAudioTags
POST /api/v1/dataset/getImageCaption
GET  /api/v1/muse/image/getImageDownloadUrl
POST /api/v1/muse/image/list
POST /api/v1/muse/image/batchDelete
POST /api/v1/rm/fc?Type=translate-readme
```

---

## 6. 账号体系

### 6.1 注册链路（逆向自 `index-7NIgzoXo.js`）

| 步骤 | 接口 | 说明 |
|---|---|---|
| 1 | `POST /api/v1/auth/check` | `{email, user_name}` → `{success, msg}` 校验邮箱/用户名可用 |
| 2 | `POST /api/v1/auth/sendEmail` | `{email, password: RSA(pwd), from_site:"MaaS", captcha_verify}` → 发激活邮件 |
| 3 | 点邮件里的确认链接 | 激活账号 |
| 4 | `POST /api/v1/auth/loginRegister` | `{email, user_name, password: RSA(pwd), from_site:"MaaS", callback_url}` → 完成注册 |

返回码语义：`code === 11` → 验证码错误；`code === 12` → 业务告警（带 `msg`）。

### 6.2 密码加密

- 前端用 **JSEncrypt**（`lib-lYxkE-rp.js`），RSA-2048 / PKCS#1 v1.5 / Base64 输出。
- 公钥硬编码在 `index-7NIgzoXo.js`：

```
-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn8Ue/SM/Jsn9HqDXuj2l
ILgccwtZDnEM47oKi/Vo5c/UHmJNj+ypRtBlHy2qgUnW2xFYFJ9wvODe0wsCSq3F
s7JGJGAUQixKTvdhOa8PvtnG8qmtmCx9Ib0Tei4i7Aa7h2xyLKkG07ylKGyQhIze
5efUXdAy1jCGgyHC/5LIwIkiF1/LjrOCPe1OEAMuPNunZ96nm1thahiqp6oHD4OZ
3gmRNE+GSwWNpsbCbbRw0dSS6Crhrr229h3myDs5wzKvXMaFtelFVY8bQJKZhipi
FFvz4AiBL4vWrETEe9Gcgit7MCpYswzBpTtympuseEZMBNxlIyFNteEggEt4Wyup
PwIDAQAB
-----END PUBLIC KEY-----
```

密码强度规则（前端校验）：长度 ≥ 8 且含数字、含字母、含大写或符号。

### 6.3 人机验证（关键阻塞点）

- 阿里云验证码 2.0（`AliyunCaptcha.js`），`mode: popup`，滑块。
- **SceneId**：`49006ysb`；**prefix**：国内 `18o9k0`，国际 `183lxic`；**region**：`cn` / `sgp`。
- 回调产出 `captcha_verify` 字符串，随 `sendEmail` / `loginRegister` 提交。
- 无有效 `captcha_verify` → `code 11`。

**网关侧三条可用路径**（本项目全部实现）：

1. **浏览器托管注册**（推荐）：复用本机 Chromium（bsk/CDP），自动填表，滑块由操作员一次性拖过或人工介入。
2. **令牌注入**：操作员在浏览器里过掉验证码，把 `captcha_verify` 贴进 WebUI，网关完成剩余链路。
3. **无验证码降级**：部分网络/风控档位下 `captcha_verify` 可为空（返回 `code 12` 或直接成功），网关自动探测。

### 6.4 会话

- 登录态 = Cookie（`csrf_token` 等）；写操作自动带 `X-CSRF-TOKEN`。
- 请求头约定：`X-ModelScope-Trace-Id`、`X-ModelScope-Accept-Language`、`bx-v: 2.5.37`。
- `GET /api/v1/users/login/info` → 401 表示未登录；200 且 `Success` 表示已登录。
- `GET /api/v1/users/info`、`GET /api/v1/users/tokens/list`、`GET /api/v1/users/privilege` 可用于账号健康检查。

---

## 7. 主题令牌（UI 对齐用）

来源：`ui-tokens-Dax9kBFT.js`，原表 `[dark, light]` 二元组，共 54 个令牌。

| 令牌 | dark | light |
|---|---|---|
| `colorBgLayout` | `#000000` | `#FFFFFF` |
| `colorBgElevated` | `#1A1A1A` | `#F7F9FD` |
| `colorBgContainer` | `#262626` | `#FFFFFF` |
| `colorBgHeader` | `rgba(0,0,0,.8)` | `rgba(255,255,255,.9)` |
| `colorBgSolid`（主色） | `#624AFF` | `#624AFF` |
| `colorBgSolidHover` | `#533FD9` | `#533FD9` |
| `colorBgSolidPress` | `#4534B2` | `#4534B2` |
| `colorText` | `rgba(255,255,255,.9)` | `#27254C` |
| `colorTextSecondary` | `rgba(255,255,255,.6)` | `#7C7A99` |
| `colorBorder` | `rgba(255,255,255,.2)` | `#DAD9E6` |
| `colorBorderSecondary` | `rgba(255,255,255,.1)` | `#E1E0E7` |
| `colorBorderTertiary` | `rgba(255,255,255,.06)` | `#E8E7EB` |
| `colorInfoBg` | `#181240` | `#F6F5FF` |
| `colorOmniBorderStart/Mid/End` | `#A970FF`/`#7646FA`/`#4760FF` | `#FFBB98`/`#C55AFA`/`#624AFF` |
| `colorOmniTabBorder` | `#5D5CFF` | `#5D5CFF` |

字体栈（源站）：`"SF Pro Display","SF Pro Text","PingFang SC","Helvetica Neue","Noto Sans SC","Microsoft YaHei",sans-serif`
圆角：输入面板 `20px`、视频容器 `14px`、参数折叠面板 `14px`。

---

## 8. 未解 / 待验证

- `/openapi/*` 是否接受 **Access Token**（`/api/v1/users/tokens`）替代 Cookie —— 待实测；网关同时支持两种注入方式。
- Agent 模式 SSE 的完整事件字段（`image_generation_result.content` 内部结构）—— 需要真实账号跑一次才能定稿。
- 视频生成是否同步返回还是返回 `task_id` 轮询 —— 需要真实账号跑一次才能定稿。
- 阿里云验证码在无头环境下的通过率 —— 取决于 IP 风控档位。
