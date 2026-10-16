# 打包 civision-gateway 源码到桌面
# 用法: powershell -ExecutionPolicy Bypass -File scripts\pack-source.ps1
#
# 只打源码与文档；运行时数据（数据库 / 管理令牌 / 配置 / 托管浏览器 profile / 日志）全部排除。

[CmdletBinding()]
param(
  [string]$OutDir = "",
  [string]$Stamp  = (Get-Date -Format 'yyyyMMdd')
)

$ErrorActionPreference = 'Stop'
try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
if (-not $OutDir) { $OutDir = [Environment]::GetFolderPath('Desktop') }

$Name    = "civision-gateway-src-$Stamp"
$Stage   = Join-Path $env:TEMP "civision-pack-$Stamp"
$StageRoot = Join-Path $Stage $Name
$ZipPath = Join-Path $OutDir "$Name.zip"

# ---------------------------------------------------------------- 排除规则
# 相对 $Root 的路径前缀，命中即整棵子树排除
$ExcludeDirs = @(
  'server\data\browser-profile',   # 托管浏览器 profile：含 modelscope 登录态，~95MB
  'server\data\uploads',           # 参考图本地落盘
  'logs',                          # 运行日志
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache'
)
$ExcludeFiles = @(
  'server\data\gateway.db',        # 含账号 Cookie / API KEY 哈希 / 任务记录
  'server\data\gateway.db-wal',
  'server\data\gateway.db-shm',
  'server\data\admin.token',       # 管理台令牌
  'server\data\config.json',       # 运行配置（可能含代理/IMAP 凭据）
  'server\data\civision.pid',
  'server\data\watchdog.heartbeat',
  'tests\refill_result.json'       # 实测残留（含临时邮箱地址）
)

function Test-Excluded([string]$rel) {
  foreach ($d in $ExcludeDirs) {
    if ($rel -eq $d -or $rel.StartsWith($d + '\')) { return $true }
  }
  if ($rel -split '\\' | Where-Object { $_ -eq '__pycache__' }) { return $true }
  foreach ($f in $ExcludeFiles) {
    if ($rel -eq $f) { return $true }
  }
  if ($rel -like '*.pyc' -or $rel -like '*.pyo' -or $rel -like '*.log') { return $true }
  return $false
}

# ---------------------------------------------------------------- 暂存
Write-Host "`n=== 1/3 收集文件 ===" -ForegroundColor Cyan
if (Test-Path $Stage) { Remove-Item -LiteralPath $Stage -Recurse -Force }
New-Item -ItemType Directory -Force -Path $StageRoot | Out-Null

$copied = 0
$skipped = 0
$bytes = 0

Get-ChildItem -LiteralPath $Root -Recurse -File -Force | ForEach-Object {
  $rel = $_.FullName.Substring($Root.Length + 1)
  if (Test-Excluded $rel) { $skipped++; return }
  $dest = Join-Path $StageRoot $rel
  $destDir = Split-Path -Parent $dest
  if (-not (Test-Path $destDir)) { New-Item -ItemType Directory -Force -Path $destDir | Out-Null }
  Copy-Item -LiteralPath $_.FullName -Destination $dest -Force
  $copied++
  $bytes += $_.Length
}
Write-Host ("  收进 {0} 个文件，{1:N1} MB" -f $copied, ($bytes / 1MB))
Write-Host ("  排除 {0} 个文件" -f $skipped)

# ---------------------------------------------------------------- 安全自检
Write-Host "`n=== 2/3 敏感文件自检 ===" -ForegroundColor Cyan
$leak = @()
foreach ($pat in @('gateway.db', 'admin.token', 'config.json', 'browser-profile',
                   'civision.pid', 'watchdog.heartbeat', '.log')) {
  $hit = Get-ChildItem -LiteralPath $StageRoot -Recurse -File -Force -ErrorAction SilentlyContinue |
         Where-Object { $_.FullName -like "*$pat*" -and $_.Name -ne 'config.example.json' }
  if ($hit) { $leak += ($hit | ForEach-Object { $_.FullName.Substring($StageRoot.Length + 1) }) }
}
if ($leak.Count) {
  Write-Host "  ❌ 发现不该带的文件，已中止：" -ForegroundColor Red
  $leak | ForEach-Object { Write-Host "     $_" }
  throw "打包中止：暂存目录里出现敏感文件"
}
Write-Host "  ✅ 没有数据库 / 令牌 / 运行配置 / 浏览器 profile / 日志" -ForegroundColor Green

# 顺带确认关键文件在
foreach ($must in @('README.md', 'requirements.txt', 'server\app.py', 'server\browser.py',
                    'webui\index.html', 'docs\PROTOCOL.md', 'docs\CAPTCHA.md',
                    'server\data\registry.json', 'server\data\config.example.json')) {
  $p = Join-Path $StageRoot $must
  if (Test-Path $p) { Write-Host "  ✅ $must" -ForegroundColor Green }
  else { Write-Host "  ⚠️  缺少 $must" -ForegroundColor Yellow }
}

# ---------------------------------------------------------------- 压缩
Write-Host "`n=== 3/3 压缩到桌面 ===" -ForegroundColor Cyan
if (-not (Test-Path $OutDir)) { throw "输出目录不存在: $OutDir" }
if (Test-Path $ZipPath) { Remove-Item -LiteralPath $ZipPath -Force }

Add-Type -AssemblyName System.IO.Compression.FileSystem
# 用 $StageRoot 作源 + includeBaseDirectory=$true，压缩包顶层就是 civision-gateway-src-<日期>\
# （别传 $Stage，那会多套一层 civision-pack-<日期>\）
[System.IO.Compression.ZipFile]::CreateFromDirectory(
  $StageRoot, $ZipPath, [System.IO.Compression.CompressionLevel]::Optimal, $true)

$zip = Get-Item -LiteralPath $ZipPath
Write-Host ("  {0}" -f $zip.FullName) -ForegroundColor Green
Write-Host ("  {0:N1} MB" -f ($zip.Length / 1MB))

Remove-Item -LiteralPath $Stage -Recurse -Force -ErrorAction SilentlyContinue

Write-Host @"

  打包完成。解压后：
    cd civision-gateway
    powershell -ExecutionPolicy Bypass -File scripts\deploy.ps1

  （首次部署会自动生成 config.json / admin.token / gateway.db，并打印一把 API KEY）
"@ -ForegroundColor Gray
