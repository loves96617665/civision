# civision-gateway 本地服务

> **本机是 Windows PowerShell 5.1**（没有 `pwsh`），下面统一用 `powershell`。
> 装了 PowerShell 7 就把 `powershell` 换成 `pwsh`，脚本两者都兼容。
> 所有 `.ps1` 都带 **UTF-8 BOM**：PS 5.1 对无 BOM 的 UTF-8 会按 GBK 解析，中文会直接把语法解析搞崩。

## 部署

```powershell
# 一次性：装依赖 + 初始化 + 启动 + 注册自启/看门狗 + 验证
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1

# 换端口 / 允许局域网访问 / 不注册自愈
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Port 9000
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -ExposeLan
powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -NoAutostart
```

部署默认会注册**自愈机制**（见下），跑完就是一个能扛住进程被杀的常驻服务。

## 自愈机制（重要）

进程会以各种方式死掉：被外部工具清理、被任务管理器结束、僵死占着端口不响应。
光"脱离进程树"不够 —— **必须有人监督**。

| 任务 | 触发 | 动作 | 作用 |
|---|---|---|---|
| `civision-gateway` | 用户登录时 | `civision.ps1 start` | 登录后拉起一次 |
| `civision-gateway-watchdog` | **每 1 分钟** | `civision.ps1 watchdog` | 探 `http://127.0.0.1:8787/`，不可达就拉回 |

看门狗处理两种情况：

- **进程没了**（端口空闲）→ 直接 `start`
- **进程僵死**（端口被 python 占着但不响应 HTTP）→ 先杀掉再 `start`
- **端口被非 python 进程占用** → 不动它，记 `FOREIGN` 到心跳文件，避免误杀无关服务

心跳文件 `server\data\watchdog.heartbeat` 每次记录结果：

```
2026-10-13T15:38:44  OK pid=2108
2026-10-13T15:34:22  FOREIGN pid=7292          ← 端口被非 python 占用，未处理
2026-10-13T15:32:24  RESTARTED pid=28764       ← 拉回过一次
2026-10-13T15:31:10  FAILED <原因>
```

### 为什么主任务用 `start` 而不是前台 `run`

试过让任务计划程序前台托管（`run`，任务状态 Running、失败自动重拉），
但那样**看门狗一补位，前台实例就会因为端口被占而退出**，两套监督机制互相打架。
现在让**看门狗做唯一的权威监督者**，主任务只负责"登录后拉一次"。

`run` 动作仍然保留，供你手动前台调试用：

```powershell
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 run    # Ctrl+C 结束
```

### 实测自愈

| 场景 | 操作 | 结果 |
|---|---|---|
| 进程被杀 | `Stop-Process -Force` 杀掉 python | 看门狗 **54.5 秒**拉回，新 PID，心跳 `RESTARTED` |
| 进程僵死 | 用假 python 占住 8787 不响应 HTTP | 看门狗判定僵死 → 杀掉 → 重启 → HTTP 200 |

## 服务控制

```powershell
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 status          # 进程/端口/上游/号池/模型/请求统计
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 start           # 启动（WMI 脱离进程树）
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 stop
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 restart
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 watchdog        # 手动跑一次看门狗
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 logs -Tail 80
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 logs -Follow    # 跟踪
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 selftest        # 端到端自检
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 open            # 浏览器打开工作台
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 run             # 前台运行（调试用）
```

### 两个环境坑（脚本已内置处理）

1. **进程脱离**：`Start-Process` 起的是子进程，启动它的终端一被 kill 服务就跟着死。
   脚本改用 **WMI `Win32_Process.Create`** 创建进程（父进程是 WmiPrvSE，不在调用者进程树里），
   PID 由 `server/run.py` 自己写进 `data/civision.pid`。
2. **环境变量大小写重复**：Windows 上 `NO_PROXY` / `no_proxy` 会同时存在于进程环境，
   PS 5.1 的 `Env:` 提供程序与 `Start-Process` 都会抛
   `Item has already been added. Key in dictionary: 'NO_PROXY' Key being added: 'no_proxy'`。
   脚本在启动前 `Repair-EnvDuplicates` 按大写归并（Windows API 本身大小写不敏感，行为不变）。

`civision.ps1 stop` 只认自己 PID 文件里的进程；若端口被别的 python 占用会明确报出来，不误杀无关进程。

## 开机自启 / 自愈任务管理

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1              # 用户登录时（默认，免管理员）
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -AtStartup   # 系统启动时（需管理员，SYSTEM 账号）
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -NoWatchdog  # 只要自启，不要看门狗
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -WatchdogMinutes 5
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove      # 取消

Start-ScheduledTask -TaskName civision-gateway        # 立刻跑一次
Get-ScheduledTask -TaskName civision-gateway, civision-gateway-watchdog | Select TaskName, State
Get-ScheduledTaskInfo -TaskName civision-gateway-watchdog
```

任务设置：失败自动重试（间隔 1 分钟、最多 999 次）、无执行时长上限、错过的触发补跑。

> ⚠️ 坑：`-RepetitionDuration` **不能用 `[TimeSpan]::MaxValue`** —— 会生成
> `Duration:P99999999DT23H59M59S` 导致 `The task XML contains a value which is incorrectly
> formatted or out of range`。脚本里用的是 `[TimeSpan]::FromDays(3650)`（10 年 ≈ 永久）。

## 运行产物

| 路径 | 说明 |
|---|---|
| `server\data\civision.pid` | 当前进程 PID（由 run.py 写入） |
| `logs\gateway.log` | 服务 stdout（uvicorn 日志 + 启动横幅） |
| `logs\gateway.err.log` | 服务 stderr（启动失败先看这个） |
| `server\data\gateway.db` | SQLite（KEY / 号池 / 任务 / 日志） |
| `server\data\admin.token` | 管理台令牌（首次启动生成） |
| `server\data\config.json` | 运行配置 |
| `server\data\uploads\` | 参考图本地落盘 |

## 卸载

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 stop
Remove-Item -Recurse -Force D:\DSH\civision-gateway\server\data   # 连同号池/KEY 一起删
```
