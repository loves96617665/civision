<#
.SYNOPSIS
  civision-gateway 一键本地部署

.DESCRIPTION
  1) 检查 Python / pip
  2) 安装依赖（requirements.txt）
  3) 初始化数据目录（配置 / 模型注册表 / 数据库 / 管理令牌）
  4) 拉起常驻服务并等待就绪
  5) 注册计划任务：登录自启 + 1 分钟看门狗（默认开启）
  6) 端到端自检 + 打印访问信息与 API KEY

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -Port 9000 -SkipInstall
  powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1 -NoAutostart    # 不注册自启/看门狗
#>
[CmdletBinding()]
param(
  [string]$Host_ = '127.0.0.1',
  [int]$Port = 8787,
  [switch]$SkipInstall,
  [switch]$NoAutostart,
  [switch]$ExposeLan
)

$ErrorActionPreference = 'Stop'
$Root    = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server  = Join-Path $Root 'server'
$Scripts = Join-Path $Root 'scripts'
$Ctl     = Join-Path $Scripts 'civision.ps1'

# 本机可能是 Windows PowerShell 5.1（没有 pwsh），动态解析可执行文件
$PwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $PwshExe) { $PwshExe = (Get-Command powershell).Source }

if ($ExposeLan) { $Host_ = '0.0.0.0' }
$BaseUrl = "http://$(if ($Host_ -eq '0.0.0.0') { '127.0.0.1' } else { $Host_ }):${Port}"

function Head($t) { Write-Host "`n=== $t ===" -ForegroundColor Cyan }
function Ok($t)   { Write-Host "  [OK]   $t" -ForegroundColor Green }
function Warn($t) { Write-Host "  [WARN] $t" -ForegroundColor Yellow }

Write-Host @"
+----------------------------------------------------------------------+
|  civision-gateway 本地部署                                            |
|  ModelScope Civision -> OpenAI 兼容网关 + 创作工作台 + 管理台          |
+----------------------------------------------------------------------+
"@ -ForegroundColor Magenta

# ------------------------------------------------------------ 1. Python
Head '1/5 环境检查'
$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { throw '找不到 python。请安装 Python 3.10+ 并加入 PATH 后重试。' }
$ver = (& python -c "import sys;print('%d.%d.%d'%sys.version_info[:3])").Trim()
Ok "Python $ver  ($py)"
$major, $minor = $ver.Split('.')[0..1] | ForEach-Object { [int]$_ }
if ($major -lt 3 -or ($major -eq 3 -and $minor -lt 10)) { throw "需要 Python 3.10+，当前 $ver" }

# ------------------------------------------------------------ 2. 依赖
Head '2/5 安装依赖'
if ($SkipInstall) {
  Warn '已跳过（-SkipInstall）'
} else {
  & python -m pip install --disable-pip-version-check -q -r (Join-Path $Root 'requirements.txt')
  if ($LASTEXITCODE -ne 0) { throw 'pip install 失败' }
  Ok 'requirements.txt 安装完成'
}
$probe = & python -c "import fastapi,uvicorn,httpx,cryptography,requests;print('ok')" 2>&1
if ($probe.Trim() -ne 'ok') { throw "依赖自检失败：$probe" }
Ok 'fastapi / uvicorn / httpx / cryptography / requests 均可导入'

# ------------------------------------------------------------ 3. 初始化
Head '3/5 初始化数据'
$initRaw = & python (Join-Path $Scripts '_init_data.py') 2>&1
$initLine = $initRaw | Where-Object { $_ -like 'CIVISION_INIT *' } | Select-Object -First 1
if (-not $initLine) {
  Write-Host ($initRaw -join "`n") -ForegroundColor Red
  throw '初始化失败（见上）'
}
$init = ($initLine.Substring('CIVISION_INIT '.Length) | ConvertFrom-Json)

$DataDir = Join-Path $Server 'data'
Ok "模型注册表：启用 $($init.models_enabled) / 共 $($init.models_total)（新增 $($init.seeded) 条）"
foreach ($p in $init.files.PSObject.Properties) {
  if ($p.Value) { Ok "$($p.Name) 就绪" } else { Warn "$($p.Name) 缺失" }
}
$defaultKey = [string]$init.new_key
if ($defaultKey) { Ok '已生成默认 API KEY' }
else { Ok "已存在 $($init.keys_existing) 把 API KEY（明文不可再取，可在管理台新建）" }

# ------------------------------------------------------------ 4. 启动
Head '4/5 启动服务'
& $PwshExe -NoProfile -ExecutionPolicy Bypass -File $Ctl stop | Out-Null
Start-Sleep -Seconds 1
& $PwshExe -NoProfile -ExecutionPolicy Bypass -File $Ctl start -Host_ $Host_ -Port $Port
if ($LASTEXITCODE -ne 0) { throw '服务启动失败' }

# ------------------------------------------------------------ 5. 验证
Head '5/5 部署验证'
$checks = @()
$h = try { Invoke-WebRequest "$BaseUrl/" -UseBasicParsing -TimeoutSec 8; $null } catch { $_ }
$checks += @{ n = 'WebUI 首页'; ok = ($null -ne $h -and $h.StatusCode -eq 200) }

$tok = [string]$init.admin_token
try {
  $ov = Invoke-RestMethod "$BaseUrl/admin/api/overview" -Headers @{ 'X-Admin-Token' = $tok } -TimeoutSec 30
  $checks += @{ n = '管理接口'; ok = $true }
  $checks += @{ n = '模型注册表'; ok = ($ov.models.enabled -gt 0) }
  $checks += @{ n = '上游可达'; ok = [bool]$ov.upstream.reachable }
} catch {
  $checks += @{ n = '管理接口'; ok = $false }
}

if ($defaultKey) {
  try {
    $ms = Invoke-RestMethod "$BaseUrl/v1/models" -Headers @{ Authorization = "Bearer $defaultKey" } -TimeoutSec 15
    $checks += @{ n = "OpenAI 兼容面（$($ms.data.Count) 个模型）"; ok = ($ms.data.Count -gt 0) }
  } catch { $checks += @{ n = 'OpenAI 兼容面'; ok = $false } }
} else {
  Warn '没有可用的明文 KEY，跳过 OpenAI 兼容面探测'
}

$allOk = $true
foreach ($c in $checks) {
  if ($c.ok) { Ok $c.n } else { Warn "$($c.n) —— 未通过"; $allOk = $false }
}

# ------------------------------------------------------------ 自启 + 看门狗
if (-not $NoAutostart) {
  Head '5.5/5 注册自启与看门狗'
  & $PwshExe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Scripts 'install-autostart.ps1') -Host_ $Host_ -Port $Port
} else {
  Warn '已跳过自启注册（-NoAutostart）—— 服务不会自愈，进程挂掉需要手动 start'
}

# ------------------------------------------------------------ 收尾
Write-Host "`n" -NoNewline
Write-Host ('=' * 72) -ForegroundColor Magenta
if ($allOk) { Write-Host '  部署完成 ✅' -ForegroundColor Green }
else        { Write-Host '  部署完成（有未通过项，见上）' -ForegroundColor Yellow }
Write-Host ('=' * 72) -ForegroundColor Magenta

Write-Host @"

  创作工作台   $BaseUrl/
  管理台       $BaseUrl/#/admin
  OpenAI 基址  $BaseUrl/v1
  接口文档     $BaseUrl/docs
  管理台令牌   $tok
"@
if ($defaultKey) { Write-Host "  默认 API KEY $defaultKey   （只显示这一次，请立即保存）`n" -ForegroundColor DarkYellow }
else { Write-Host "  API KEY      在管理台「API KEY」页新建`n" -ForegroundColor DarkYellow }

Write-Host @"
  常用命令
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 status       # 看状态
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 restart      # 重启
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 logs -Tail 80
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 selftest     # 端到端自检
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 watchdog     # 手动跑一次看门狗
    powershell -ExecutionPolicy Bypass -File scripts\civision.ps1 open         # 打开工作台

  自愈机制（已注册，默认开启）
    civision-gateway          登录时拉起
    civision-gateway-watchdog 每 1 分钟探测，进程被杀/僵死都会自动拉回
    取消： powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove

  下一步：进管理台 -> 号池 -> 手动粘贴 Cookie 或「一键注册补号」
"@ -ForegroundColor Gray
