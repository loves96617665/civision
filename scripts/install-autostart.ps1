<#
.SYNOPSIS
  注册 civision-gateway 的开机自启 + 看门狗（Windows 计划任务）

.DESCRIPTION
  注册两个任务：

  1. `civision-gateway`          —— 前台运行网关，由任务计划程序**直接托管**。
       进程活着 = 任务 Running；进程挂了 = 任务结束，按 RestartCount 自动重拉。
       注意：不要用 `start`（那会脱离进程树，任务瞬间“成功”，python 死了没人管）。

  2. `civision-gateway-watchdog` —— 每 1 分钟探一次端口，不可达就拉起。
       双保险，覆盖“进程被杀”和“进程僵死（端口在但不响应）”两种情况。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -AtStartup -Port 9000
  powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
#>
[CmdletBinding()]
param(
  [string]$Host_ = '127.0.0.1',
  [int]$Port = 8787,
  [switch]$AtStartup,
  [switch]$NoWatchdog,
  [int]$WatchdogMinutes = 1,
  [switch]$Remove,
  [string]$TaskName = 'civision-gateway'
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root  = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Ctl   = Join-Path $Root 'scripts\civision.ps1'
$Watch = "$TaskName-watchdog"

$pwshExe = (Get-Command pwsh -ErrorAction SilentlyContinue).Source
if (-not $pwshExe) { $pwshExe = (Get-Command powershell).Source }

if ($Remove) {
  foreach ($t in @($TaskName, $Watch)) {
    if (Get-ScheduledTask -TaskName $t -ErrorAction SilentlyContinue) {
      Unregister-ScheduledTask -TaskName $t -Confirm:$false
      Write-Host "已移除计划任务 $t" -ForegroundColor Green
    } else {
      Write-Host "计划任务 $t 不存在" -ForegroundColor Yellow
    }
  }
  return
}

if (-not (Test-Path $Ctl)) { throw "找不到 $Ctl" }

function New-RunnerTask {
  param([string]$Name, [string]$Verb, $Trigger, $Principal, [string]$Description)
  $argLine = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$Ctl`" $Verb -Host_ $Host_ -Port $Port"
  $action = New-ScheduledTaskAction -Execute $pwshExe -Argument $argLine -WorkingDirectory $Root
  # 挂了就重拉，最多 999 次、每分钟一次；无执行时长上限（服务要常驻）
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
                -StartWhenAvailable -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) `
                -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  if (Get-ScheduledTask -TaskName $Name -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $Name -Confirm:$false
  }
  Register-ScheduledTask -TaskName $Name -Action $action -Trigger $Trigger `
    -Principal $Principal -Settings $settings -Description $Description | Out-Null
}

# ---------------------------------------------------------------- 1. 主服务
if ($AtStartup) {
  $trigger   = New-ScheduledTaskTrigger -AtStartup
  $principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
  $where     = '系统启动时（SYSTEM）'
} else {
  $trigger   = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $where     = "用户 $env:USERNAME 登录时"
}

# 主任务用 start（WMI 脱离进程树，立刻返回）。
# 不用 run（前台托管）：看门狗一旦补位，前台实例会因为端口被占而退出，
# 两套监督机制互相打架。让看门狗做唯一的权威监督者。
New-RunnerTask -Name $TaskName -Verb 'start' -Trigger $trigger -Principal $principal `
  -Description "civision-gateway: 登录时拉起网关（http://${Host_}:${Port}/），常驻监督由 $Watch 负责"

Write-Host "已注册主服务任务 $TaskName" -ForegroundColor Green
Write-Host "  触发    : $where"
Write-Host "  动作    : $Ctl start -Host_ $Host_ -Port $Port"

# ---------------------------------------------------------------- 2. 看门狗
if (-not $NoWatchdog) {
  # 注意：-RepetitionDuration 不能用 [TimeSpan]::MaxValue，
  # 会生成 Duration:P99999999DT23H59M59S 导致 "incorrectly formatted or out of range"。
  # 用 10 年（≈永久）这个合法值。
  $wTrig = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
             -RepetitionInterval (New-TimeSpan -Minutes $WatchdogMinutes) `
             -RepetitionDuration ([TimeSpan]::FromDays(3650))
  New-RunnerTask -Name $Watch -Verb 'watchdog' -Trigger $wTrig -Principal $principal `
    -Description "civision-gateway 看门狗：每 $WatchdogMinutes 分钟探测 http://${Host_}:${Port}/，不可达则拉起"
  Write-Host "已注册看门狗任务 $Watch" -ForegroundColor Green
  Write-Host "  触发    : 每 $WatchdogMinutes 分钟（持续 10 年）"
  Write-Host "  动作    : $Ctl watchdog -Host_ $Host_ -Port $Port"
}

Write-Host @"

  立即启动   : Start-ScheduledTask -TaskName $TaskName
  查看状态   : Get-ScheduledTask -TaskName $TaskName, $Watch | Select TaskName, State
  上次结果   : Get-ScheduledTaskInfo -TaskName $TaskName
  取消自启   : powershell -ExecutionPolicy Bypass -File scripts\install-autostart.ps1 -Remove
"@ -ForegroundColor Gray
