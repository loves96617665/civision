<#
.SYNOPSIS
  civision-gateway 本地服务控制器（启动 / 停止 / 重启 / 状态 / 日志 / 自检）

.DESCRIPTION
  以「分离进程」方式运行网关，不受启动它的终端影响；PID 落盘到
  server\data\civision.pid，stdout/stderr 追加到 logs\gateway.log。

.EXAMPLE
  pwsh -File scripts\civision.ps1 start
  pwsh -File scripts\civision.ps1 status
  pwsh -File scripts\civision.ps1 logs -Tail 80
  pwsh -File scripts\civision.ps1 restart -Port 9000
#>
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('start', 'stop', 'restart', 'status', 'logs', 'open', 'selftest',
               'run', 'watchdog', 'help')]
  [string]$Action = 'status',

  [string]$Host_ = '127.0.0.1',
  [int]$Port = 8787,
  [int]$Tail = 60,
  [switch]$Follow,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'

# 控制台按 UTF-8 输出，避免中文在 GBK 代码页下变乱码（后端返回的是 UTF-8 JSON）
try {
  [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
  $OutputEncoding = [System.Text.Encoding]::UTF8
} catch { }

# ------------------------------------------------------------------ 路径
$Root     = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Server   = Join-Path $Root 'server'
$DataDir  = Join-Path $Server 'data'
$LogDir   = Join-Path $Root 'logs'
$PidFile  = Join-Path $DataDir 'civision.pid'
$OutLog   = Join-Path $LogDir 'gateway.log'
$ErrLog   = Join-Path $LogDir 'gateway.err.log'
$AdminTok = Join-Path $DataDir 'admin.token'
$BaseUrl  = "http://${Host_}:${Port}"

New-Item -ItemType Directory -Force -Path $LogDir  | Out-Null
New-Item -ItemType Directory -Force -Path $DataDir | Out-Null

# ------------------------------------------------------------------ 工具
function Write-Head($text) { Write-Host "`n$text" -ForegroundColor Cyan }

<#
  环境变量大小写重复修复。
  Windows 上 NO_PROXY / no_proxy 这类同名不同大小写的变量会同时存在于进程环境里，
  PowerShell 5.1 的 Env: 提供程序与 Start-Process 都会因此抛
  "Item has already been added. Key in dictionary: 'NO_PROXY' Key being added: 'no_proxy'"。
  这里按大写分组，只保留大写形式，删掉重复变体（Windows API 本身大小写不敏感，行为不变）。
#>
function Repair-EnvDuplicates {
  $vars = [System.Environment]::GetEnvironmentVariables('Process')
  $groups = @{}
  foreach ($k in $vars.Keys) {
    $key = [string]$k
    $u = $key.ToUpperInvariant()
    if (-not $groups.ContainsKey($u)) { $groups[$u] = @() }
    $groups[$u] += $key
  }
  $removed = @()
  foreach ($u in $groups.Keys) {
    $names = $groups[$u]
    if ($names.Count -le 1) { continue }
    foreach ($n in $names) {
      if ($n -cne $u) {
        [System.Environment]::SetEnvironmentVariable($n, $null, 'Process')
        $removed += $n
      }
    }
  }
  if ($removed.Count) {
    Write-Host "  [env] 清理 $($removed.Count) 个大小写重复的环境变量：$($removed -join ', ')" -ForegroundColor DarkGray
  }
  return $removed.Count
}

function Get-Python {
  $cmd = Get-Command python -ErrorAction SilentlyContinue
  if (-not $cmd) { throw '找不到 python，请先安装 Python 3.10+ 并加入 PATH' }
  return $cmd.Source
}

function Get-RecordedPid {
  if (-not (Test-Path $PidFile)) { return $null }
  $raw = (Get-Content $PidFile -Raw -ErrorAction SilentlyContinue)
  $n = 0
  if ([int]::TryParse(($raw -as [string]).Trim(), [ref]$n)) { return $n }
  return $null
}

function Test-Alive([int]$ProcessId) {
  if (-not $ProcessId) { return $false }
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (-not $p) { return $false }
  return $p.ProcessName -like 'python*'
}

function Get-PortOwner([int]$p) {
  $c = Get-NetTCPConnection -State Listen -LocalPort $p -ErrorAction SilentlyContinue |
       Select-Object -First 1
  if ($c) { return [int]$c.OwningProcess }
  return $null
}

function Test-Http([string]$url, [int]$timeoutSec = 5) {
  try {
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec $timeoutSec
    return @{ ok = $true; status = [int]$r.StatusCode }
  } catch {
    return @{ ok = $false; status = 0; error = $_.Exception.Message }
  }
}

function Get-AdminToken {
  if (Test-Path $AdminTok) { return (Get-Content $AdminTok -Raw).Trim() }
  return ''
}

# ------------------------------------------------------------------ start
function Start-Gateway {
  $existing = Get-RecordedPid
  if ((Test-Alive $existing) -and -not $Force) {
    Write-Host "已在运行（PID $existing，$BaseUrl）" -ForegroundColor Yellow
    Write-Host "要重启用 restart；要强制新开一个用 start -Force" -ForegroundColor DarkGray
    return
  }
  if ($Force -and (Test-Alive $existing)) { Stop-Gateway -Quiet }

  $owner = Get-PortOwner $Port
  if ($owner -and -not $Force) {
    throw "端口 $Port 已被 PID $owner 占用（先 stop，或换 -Port）"
  }

  $py = Get-Python
  Write-Head "启动 civision-gateway"
  Repair-EnvDuplicates | Out-Null
  Write-Host "  工作目录 : $Server"
  Write-Host "  监听     : $BaseUrl"
  Write-Host "  日志     : $OutLog"

  $env:CIVISION_HOST = $Host_
  $env:CIVISION_PORT = "$Port"

  # 用 WMI 创建进程：它不是本 shell 的子进程，启动终端关掉 / 被 kill 都不影响服务。
  # PID 由 server\run.py 自己写进 data\civision.pid（WMI 拿不到真实 python PID）。
  $launcher = Join-Path $Server 'run.py'
  $cmdline  = '"{0}" "{1}" --host {2} --port {3} --log-level info' -f $py, $launcher, $Host_, $Port

  Remove-Item $PidFile -ErrorAction SilentlyContinue
  $started = $false
  try {
    $r = ([wmiclass]'Win32_Process').Create($cmdline, $Server, $null)
    if ($r.ReturnValue -eq 0) {
      $started = $true
      Write-Host "  方式     : WMI（脱离进程树）"
    } else {
      Write-Host "  WMI 创建失败 ReturnValue=$($r.ReturnValue)，回退 Start-Process" -ForegroundColor DarkYellow
    }
  } catch {
    Write-Host "  WMI 不可用（$($_.Exception.Message)），回退 Start-Process" -ForegroundColor DarkYellow
  }

  if (-not $started) {
    Start-Process -FilePath $py `
      -ArgumentList @($launcher, '--host', $Host_, '--port', "$Port", '--log-level', 'info') `
      -WorkingDirectory $Server -WindowStyle Hidden | Out-Null
  }

  # 等 run.py 写 PID + 端口就绪（最多 30s）
  $ready = $false
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Milliseconds 500
    if (-not (Test-Path $PidFile)) { continue }
    $h = Test-Http "$BaseUrl/" 2
    if ($h.ok) { $ready = $true; break }
  }

  $newPid = Get-RecordedPid
  if ($newPid) { Write-Host "  PID      : $newPid" }

  if (-not $ready) {
    Write-Host "`n启动失败，最后 40 行日志：" -ForegroundColor Red
    if (Test-Path $ErrLog) { Get-Content $ErrLog -Tail 40 }
    if (Test-Path $OutLog) { Get-Content $OutLog -Tail 40 }
    throw "服务未在预期时间内就绪"
  }

  Write-Host "  状态     : 已就绪 ✅" -ForegroundColor Green
  Show-Access
}

# ------------------------------------------------------------------ stop
function Stop-Gateway([switch]$Quiet) {
  $id = Get-RecordedPid
  $killed = @()
  if (Test-Alive $id) {
    Stop-Process -Id $id -Force
    $killed += $id
  }
  # 兜底：端口上还挂着别的 python 也一起收掉
  $owner = Get-PortOwner $Port
  if ($owner -and $owner -ne $id -and (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName -like 'python*') {
    Stop-Process -Id $owner -Force
    $killed += $owner
  }
  Remove-Item $PidFile -ErrorAction SilentlyContinue
  if (-not $Quiet) {
    if ($killed.Count) { Write-Host "已停止 PID $($killed -join ', ')" -ForegroundColor Green }
    else { Write-Host "没有在运行" -ForegroundColor Yellow }
  }
}

# ------------------------------------------------------------------ status
function Show-Access {
  $tok = Get-AdminToken
  Write-Head "访问信息"
  Write-Host "  WebUI 创作工作台 : $BaseUrl/" -ForegroundColor White
  Write-Host "  管理台           : $BaseUrl/#/admin" -ForegroundColor White
  Write-Host "  OpenAI 兼容基址  : $BaseUrl/v1" -ForegroundColor White
  Write-Host "  接口文档         : $BaseUrl/docs" -ForegroundColor White
  if ($tok) { Write-Host "  管理台令牌       : $tok" -ForegroundColor DarkYellow }
}

function Show-Status {
  $id = Get-RecordedPid
  $alive = Test-Alive $id
  $owner = Get-PortOwner $Port
  $h = if ($alive -or $owner) { Test-Http "$BaseUrl/" 3 } else { @{ ok = $false } }

  Write-Head "civision-gateway 状态"
  Write-Host ("  进程      : " + $(if ($alive) { "运行中 (PID $id)" } elseif ($owner) { "端口被 PID $owner 占用（非本脚本启动）" } else { "未运行" }))
  Write-Host ("  端口 $Port : " + $(if ($owner) { "监听中 (PID $owner)" } else { "未监听" }))
  Write-Host ("  HTTP      : " + $(if ($h.ok) { "200 OK" } else { "不可达" }))

  if (-not ($alive -or $owner)) {
    Write-Host "`n  用 pwsh -File scripts\civision.ps1 start 启动" -ForegroundColor DarkGray
    return
  }

  $tok = Get-AdminToken
  try {
    $ov = Invoke-RestMethod -Uri "$BaseUrl/admin/api/overview" -Headers @{ 'X-Admin-Token' = $tok } -TimeoutSec 25
    Write-Host ("  版本      : " + $ov.version)
    Write-Host ("  运行时长  : " + [TimeSpan]::FromSeconds([int]$ov.uptime).ToString('hh\:mm\:ss'))
    Write-Host ("  上游      : " + $(if ($ov.upstream.reachable) { "可达（$($ov.upstream.latency_ms) ms）" } else { "不可达：" + $ov.upstream.error }))
    Write-Host ("  号池      : 可用 $($ov.pool.available) / 共 $($ov.pool.total)（冷却 $($ov.pool.cooldown)）")
    Write-Host ("  模型      : 启用 $($ov.models.enabled) / 共 $($ov.models.total)")
    Write-Host ("  请求      : 累计 $($ov.requests.total)，今日 $($ov.requests.today)，失败 $($ov.requests.failed)")
  } catch {
    Write-Host "  统计读取失败：$($_.Exception.Message)" -ForegroundColor DarkYellow
  }

  if (Test-Path $OutLog) {
    $size = [math]::Round((Get-Item $OutLog).Length / 1KB, 1)
    Write-Host "  日志      : $OutLog ($size KB)"
  }
  Show-Access
}

# ------------------------------------------------------------------ run（前台，供任务计划程序托管）
function Run-Foreground {
  $owner = Get-PortOwner $Port
  if ($owner) {
    Write-Host "[civision] 端口 $Port 已被 PID $owner 占用，前台模式退出（避免双开）" -ForegroundColor Yellow
    return 1
  }
  Repair-EnvDuplicates | Out-Null
  $py = Get-Python
  $env:CIVISION_HOST = $Host_
  $env:CIVISION_PORT = "$Port"
  Write-Host "[civision] 前台运行（由任务计划程序托管） http://${Host_}:${Port}/" -ForegroundColor Cyan
  # 阻塞在这里：进程活着 = 任务 Running；进程死了 = 任务结束，由 RestartCount 拉起
  & $py (Join-Path $Server 'run.py') --host $Host_ --port $Port --log-level info
  return $LASTEXITCODE
}

# ------------------------------------------------------------------ watchdog（看门狗）
function Invoke-Watchdog {
  $hb = Join-Path $DataDir 'watchdog.heartbeat'
  $owner = Get-PortOwner $Port
  $h = if ($owner) { Test-Http "$BaseUrl/" 3 } else { @{ ok = $false } }

  if ($owner -and $h.ok) {
    Set-Content -Path $hb -Value ("{0} OK pid={1}" -f (Get-Date -Format 'o'), $owner) -Encoding ascii
    Write-Host "[watchdog] OK  pid=$owner  $BaseUrl" -ForegroundColor DarkGray
    return 0
  }

  # 端口被占用但 HTTP 不通 = 僵死，先收尸再重拉
  if ($owner -and -not $h.ok) {
    $proc = Get-Process -Id $owner -ErrorAction SilentlyContinue
    if ($proc -and $proc.ProcessName -like 'python*') {
      Write-Host "[watchdog] pid=$owner 端口在但不响应 HTTP，判定僵死，杀掉重拉" -ForegroundColor Yellow
      Stop-Process -Id $owner -Force -ErrorAction SilentlyContinue
      Start-Sleep -Seconds 2
    } else {
      Write-Host "[watchdog] 端口 $Port 被非 python 进程 $owner 占用，不处理" -ForegroundColor Yellow
      Set-Content -Path $hb -Value ("{0} FOREIGN pid={1}" -f (Get-Date -Format 'o'), $owner) -Encoding ascii
      return 1
    }
  } else {
    Write-Host "[watchdog] $BaseUrl 不可达，拉起服务" -ForegroundColor Yellow
  }

  try {
    Start-Gateway
    $newOwner = Get-PortOwner $Port
    Set-Content -Path $hb -Value ("{0} RESTARTED pid={1}" -f (Get-Date -Format 'o'), $newOwner) -Encoding ascii
    Write-Host "[watchdog] 已拉起 pid=$newOwner" -ForegroundColor Green
    return 0
  } catch {
    Write-Host "[watchdog] 拉起失败: $($_.Exception.Message)" -ForegroundColor Red
    Set-Content -Path $hb -Value ("{0} FAILED {1}" -f (Get-Date -Format 'o'), $_.Exception.Message) -Encoding ascii
    return 1
  }
}

# ------------------------------------------------------------------ main
switch ($Action) {
  'start'    { Start-Gateway }
  'stop'     { Stop-Gateway }
  'restart'  { Stop-Gateway -Quiet; Start-Sleep -Seconds 1; Start-Gateway }
  'status'   { Show-Status }
  'open'     { Start-Process $BaseUrl; Write-Host "已在默认浏览器打开 $BaseUrl" }
  'run'      { exit (Run-Foreground) }
  'watchdog' { exit (Invoke-Watchdog) }
  'selftest' {
    $tok = Get-AdminToken
    $r = Invoke-RestMethod -Uri "$BaseUrl/admin/api/selftest" -Method Post `
         -Headers @{ 'X-Admin-Token' = $tok } -TimeoutSec 90
    Write-Head '端到端自检'
    foreach ($s in $r.steps) {
      $mark = if ($s.ok) { '✅' } else { '❌' }
      Write-Host ("  {0} {1}" -f $mark, $s.name)
      if (-not $s.ok -and $s.detail) { Write-Host ("      " + ($s.detail | ConvertTo-Json -Compress)) -ForegroundColor DarkGray }
    }
    Write-Host ("`n  结论: " + $(if ($r.ok) { '全部通过' } else { '有未通过项（号池为空属正常，先补号）' }))
  }
  'logs' {
    if (-not (Test-Path $OutLog)) { Write-Host '还没有日志'; break }
    if ($Follow) { Get-Content $OutLog -Tail $Tail -Wait }
    else { Get-Content $OutLog -Tail $Tail }
  }
  default {
    Get-Help $MyInvocation.MyCommand.Path -Detailed
  }
}
