# civision-gateway 启动脚本
# 用法:  pwsh -File start.ps1            (默认 127.0.0.1:8787)
#        pwsh -File start.ps1 -Port 9000 -Reload

param(
  [string]$Host = "127.0.0.1",
  [int]$Port = 8787,
  [switch]$Reload,
  [switch]$Install
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$server = Join-Path $root "server"

if ($Install) {
  Write-Host "[civision] 安装依赖..." -ForegroundColor Cyan
  python -m pip install -r (Join-Path $root "requirements.txt")
}

$env:CIVISION_HOST = $Host
$env:CIVISION_PORT = "$Port"

Write-Host "[civision] 工作目录 $server" -ForegroundColor Cyan
Write-Host "[civision] 监听 http://${Host}:${Port}/" -ForegroundColor Cyan

Set-Location $server
$args = @("-m", "uvicorn", "app:app", "--host", $Host, "--port", "$Port", "--log-level", "info")
if ($Reload) { $args += "--reload" }
python @args
