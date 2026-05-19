# 数据库 + 配置备份
# 用法:
#   scripts\backup.ps1                            备份到 backups\YYYYMMDD-HHMMSS\
#   scripts\backup.ps1 -Dest 'E:\sc-backups'      指定根目录
#   scripts\backup.ps1 -Keep 30                   只保留最近 30 份
[CmdletBinding()]
param(
  [string]$Dest = '',
  [int]$Keep = 14
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

# 默认备份目录: <项目根>\backups
if ([string]::IsNullOrWhiteSpace($Dest)) {
  $Dest = Join-Path $projectRoot 'backups'
}
if (-not (Test-Path $Dest)) {
  New-Item -ItemType Directory -Path $Dest | Out-Null
}

$ts = Get-Date -Format 'yyyyMMdd-HHmmss'
$snap = Join-Path $Dest $ts
New-Item -ItemType Directory -Path $snap | Out-Null

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " 备份 → $snap" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan

# 数据库 (SQLite 用 .backup 安全拷贝, 否则直接 Copy-Item)
$dbPath = if ($env:DB_PATH) { $env:DB_PATH } else { Join-Path $projectRoot 'database\smart-control.db' }
if (Test-Path $dbPath) {
  $dbDest = Join-Path $snap 'smart-control.db'
  $sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
  if ($sqlite) {
    Write-Host "[1/3] 使用 sqlite3 .backup 在线安全拷贝..." -ForegroundColor Yellow
    & sqlite3 $dbPath ".backup '$dbDest'"
  } else {
    Write-Host "[1/3] 文件复制 (sqlite3 未安装)..." -ForegroundColor Yellow
    Copy-Item -Path $dbPath -Destination $dbDest -Force
  }
  $size = [math]::Round((Get-Item $dbDest).Length / 1KB, 1)
  Write-Host "      saved: $dbDest ($size KB)" -ForegroundColor Green
} else {
  Write-Host "[1/3] 数据库不存在, 跳过: $dbPath" -ForegroundColor DarkYellow
}

# .env (敏感, 但备份保留 → 备份目录权限自管)
$envFile = Join-Path $projectRoot 'backend\.env'
if (Test-Path $envFile) {
  Copy-Item -Path $envFile -Destination (Join-Path $snap 'backend.env') -Force
  Write-Host "[2/3] backend\.env 已备份" -ForegroundColor Green
} else {
  Write-Host "[2/3] backend\.env 不存在, 跳过" -ForegroundColor DarkYellow
}

# Seed (UAT 数据用过的可保留)
$uatExport = Join-Path $snap 'uat-snapshot.json'
try {
  $uat = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/uat?pageSize=500' -Method Get -TimeoutSec 5
  $uat | ConvertTo-Json -Depth 10 | Out-File -FilePath $uatExport -Encoding utf8
  Write-Host "[3/3] UAT 验收快照已导出 (服务运行中)" -ForegroundColor Green
} catch {
  Write-Host "[3/3] UAT 导出跳过 (服务未运行或接口不可达)" -ForegroundColor DarkYellow
}

# 清理过期备份
$old = Get-ChildItem -Path $Dest -Directory | Sort-Object Name -Descending | Select-Object -Skip $Keep
foreach ($d in $old) {
  Remove-Item -Path $d.FullName -Recurse -Force
  Write-Host "  清理过期: $($d.Name)" -ForegroundColor DarkGray
}

Write-Host "`n=== 备份完成 ===" -ForegroundColor Cyan
Get-ChildItem -Path $Dest -Directory | Sort-Object Name -Descending | Select-Object -First 5 |
  Format-Table Name, LastWriteTime, @{N='SizeMB'; E={ [math]::Round((Get-ChildItem $_.FullName -Recurse | Measure-Object Length -Sum).Sum / 1MB, 2) }}
