# 过码与补号：三种方式，从最省事到兜底

> 目标：把账号弄进号池。上游注册链路的唯一阻塞点是**阿里云验证码**（SceneId `49006ysb`，滑块）。
> 下面三种方式按「你要动手的程度」排序。

---

## 方式一：浏览器托管登录 → 抓取会话（**最省事，推荐**）

**你完全不用碰 DevTools，也不用管 captcha_verify。**

1. 管理台 → **号池** → 「浏览器托管」卡片 → 点 **打开托管窗口**
   （网关会用 Playwright 拉起一个受控的 Edge 窗口，独立 profile，停在 modelscope.ai）
2. **在那个窗口里正常登录或注册** —— 滑块你自然拖一下就好，跟你平时上网一样
3. 登录成功后回到管理台，点 **抓取会话入库**

网关会从浏览器 context 里直接读 **Cookie（含 HttpOnly，`document.cookie` 读不到）**，
拼成 Cookie 头写进号池，并立刻验一次登录态。成功就显示账号健康。

> profile 是持久化的（`server\data\browser-profile`），**下次不用重新登录**，
> 直接开窗口 → 抓取会话即可。

对应接口：

```http
POST /admin/api/browser/launch        {"url":"https://modelscope.ai/"}
POST /admin/api/accounts/from-browser {"label":"我的号"}
```

---

## 方式二：托管注册（自动建邮箱 + 预填，你只拖一次滑块）

适合想批量补号、但不想手动填表的情况。

1. 管理台 → 号池 → 「浏览器托管」→ 点 **托管注册（自动建邮箱 + 预填）**
   网关会：
   - 立刻建一个临时邮箱（如 `xxx@googlemail.com`）并显示出来
   - 打开注册页
   - **自动填好邮箱 / 用户名 / 密码**（DOM 注入，选择器找不到就留给你手填）
2. 在窗口里点 **注册** → 拖一次滑块
3. **剩下的网关自己接**：
   - 嗅探器在网络上抓到 `sendEmail` 请求里的 `captcha_verify`
   - **自动回填**给正在 `waiting_captcha` 的补号任务
   - 任务继续跑 `confirm` → `loginRegister` → 入库
4. 管理台会显示临时邮箱收到的邮件，以及激活链接（可一键在托管窗口里打开）

---

## 方式三：手动粘贴（兜底）

如果托管浏览器不方便用（比如你要用自己的主力浏览器）：

1. 点「一键注册补号」→ 任务走到 `waiting_captcha` 会自动弹框
2. 点 **打开托管窗口过码**（这是弹框里的主按钮）
   - 窗口里点「注册」→ 拖滑块 → **弹框自动关闭，任务自动继续**
3. 实在不行才用「或者手动粘贴」：F12 → Network → 找 `sendEmail` 请求 → 从请求体复制
   `captcha_verify` 的值贴进去

> 粘贴很宽容：`captcha_verify=xxx`、`"xxx"`、整段 JSON `{"captcha_verify":"xxx"}` 都能识别，
> 网关会自己剥掉前缀和引号。

---

## 原理：验证码 token 是怎么被"接住"的

```
用户在托管窗口里拖滑块
        │
        ▼
AliyunCaptcha 回调产出 captcha_verify
        │
        ▼
页面发 POST https://modelscope.ai/api/v1/auth/sendEmail
        │   body: {"email":"…","password":"<RSA>","captcha_verify":"<token>"}
        ▼
Playwright 的 page.on("request") 钩子（server/browser.py::_on_request）
        │   正则匹配 captcha_verify / captchaVerify / captchaToken / captcha_token
        ▼
BrowserManager._feed_waiting_jobs(token)
        │   遍历 provision.JOBS，把所有 status == "waiting_captcha" 的任务 supply_captcha(token)
        ▼
Provisioner 的 threading.Event 被 set，任务从阻塞中醒来继续跑
```

所以**不需要你复制任何东西** —— 只要那个 token 在托管窗口里产生过一次，网关就能接住。

---

## 实现细节（踩过的坑）

| 点 | 说明 |
|---|---|
| Playwright 线程模型 | sync API 必须固定在**同一个线程**用。`server/browser.py` 起了专属 worker 线程 + 命令队列，FastAPI 侧通过 `BROWSER.launch()` 之类的同步方法下命令 |
| 用系统 Edge | `launch_persistent_context(channel="msedge")`，不下载 Playwright 自带浏览器；失败回退 `executable_path` |
| 网关在 Session 1 | WMI 创建的进程默认可能落在 Session 0（无桌面），实测落在 **Session 1**，所以能弹出可见窗口 |
| HttpOnly | `document.cookie` 读不到会话 Cookie，必须用 `context.cookies()`（Playwright/CDP 层） |
| 登录态持久化 | `user_data_dir` 独立 profile，跨网关重启保留 |
| 请求嗅探范围 | 只匹配 URL 含 `/api/v1/auth/` 且 body 里带 captcha 字段的请求，避免误抓 |
| token 归一化 | `provision.normalize_captcha()` 支持带前缀 / 带引号 / 整段 JSON |

---

## 已实测

| 验证项 | 结果 |
|---|---|
| 托管浏览器启动 | ✅ 可见 Edge 窗口打开 `https://modelscope.ai/home`，状态 `running` |
| Cookie 抓取 | ✅ 读到 6 个 modelscope Cookie（含 HttpOnly 的 `acw_tc` / `ssxmod_itna`），未登录时正确判定 `healthy=false / access forbidden` |
| 嗅探器 | ✅ 合成请求带 `captcha_verify` → 抓到 `{"length":32,"url":"…/auth/__probe"}` |
| 自动回填 | ✅ 任务日志出现 `[captcha] 已收到 captcha_verify（32 字符）`，从 `waiting_captcha` 恢复为 `running` 并继续 `sendEmail` |
| token 归一化 | ✅ `captcha_verify=ABC123` / `"ABC123"` / `{"captcha_verify":"ABC123"}` → 全部归一成 `ABC123` |
| WebUI | ✅ 号池页「浏览器托管」卡片 + 过码弹框（托管优先 + 手动兜底）渲染正常 |
| 冒烟回归 | ✅ 34/34 |
