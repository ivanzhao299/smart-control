# =====================================================================
# 展贸中心智能化中控系统 - SQLite 数据库 + 配置恢复脚本
# 文件: deploy\scripts\restore.ps1
# 用法:
#   deploy\scripts\restore.ps1                       # 列出所有快照, 不操作
#   deploy\scripts\restore.ps1 -Snapshot 20260519-0900
#   deploy\scripts\restore.ps1 -Snapshot latest      # 最新一份
#   deploy\scripts\restore.ps1 -Snapshot latest -RestoreEnv     # 同时恢复 backend\.env
#   deploy\scripts\restore.ps1 -Snapshot latest -Force          # 跳过交互式确认
# 步骤:
#   1) 停止 PM2 进程 (避免 SQLite 文件被占用)
#   2) 备份当前数据库到 backups\pre-restore-<TS>\
#   3) 用快照中的 smart-control.db 覆盖
#   4) (可选) 恢复 backend\.env
#   5) 重新启动 PM2
# =====================================================================
[CmdletBinding()]
param(
  [string]$Snapshot = '',
  [string]$BackupRoot = '',
  [string]$DbPath = '',
  [string]$ProcessName = 'smart-control-backend',
  [switch]$RestoreEnv,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')
Set-Location $projectRoot

if ([string]::IsNullOrWhiteSpace($BackupRoot)) {
  if ($env:BACKUP_DIR) { $BackupRoot = $env:BACKUP_DIR } else { $BackupRoot = Join-Path $projectRoot 'backups' }
}
if ([string]::IsNullOrWhiteSpace($DbPath)) {
  if ($env:DB_PATH) { $DbPath = $env:DB_PATH } else { $DbPath = Join-Path $projectRoot 'database\smart-control.db' }
}

if (-not (Test-Path $BackupRoot)) {
  Write-Host "未找到备份目录: $BackupRoot" -ForegroundColor Red
  exit 1
}

$snapshots = Get-ChildItem -Path $BackupRoot -Directory |
  Where-Object { Test-Path (Join-Path $_.FullName 'smart-control.db') } |
  Sort-Object Name -Descending

if ($snapshots.Count -eq 0) {
  Write-Host "备份目录中没有可用快照: $BackupRoot" -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Snapshot)) {
  Write-Host "可用快照 (共 $($snapshots.Count) 份):" -ForegroundColor Cyan
  $snapshots | Select-Object -First 20 | ForEach-Object {
    $db = Join-Path $_.FullName 'smart-control.db'
    $sizeKB = [math]::Round((Get-Item $db).Length / 1KB, 1)
    Write-Host (" - {0}  ({1} KB)  {2}" -f $_.Name, $sizeKB, $_.LastWriteTime.ToString('s'))
  }
  Write-Host ""
  Write-Host "用法: deploy\scripts\restore.ps1 -Snapshot <name|latest>" -ForegroundColor Yellow
  exit 0
}

if ($Snapshot -eq 'latest') {
  $selected = $snapshots | Select-Object -First 1
} else {
  $selected = $snapshots | Where-Object { $_.Name -eq $Snapshot } | Select-Object -First 1
}
if ($null -eq $selected) {
  Write-Host "未找到快照: $Snapshot" -ForegroundColor Red
  exit 1
}
$snapDb = Join-Path $selected.FullName 'smart-control.db'
$snapEnv = Join-Path $selected.FullName 'backend.env'

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " 恢复确认" -ForegroundColor Cyan
Write-Host "================================================" -ForegroundColor Cyan
Write-Host " 快照     : $($selected.Name)" -ForegroundColor White
Write-Host " 源 DB    : $snapDb"
Write-Host " 目标 DB  : $DbPath"
if ($RestoreEnv) { Write-Host " 同时恢复 backend\.env (源: $snapEnv)" -ForegroundColor Yellow }
Write-Host ""

if (-not $Force) {
  $ans = Read-Host '继续? 输入 yes 确认'
  if ($ans -ne 'yes') { Write-Host '已取消'; exit 0 }
}

# 1) 停止 PM2
Write-Host "[1/5] 停止 PM2 进程 $ProcessName ..." -ForegroundColor Yellow
& pm2 stop $ProcessName 2>$null | Out-Null

# 2) 当前数据库备份到 pre-restore
$preRestore = Join-Path $BackupRoot ("pre-restore-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $preRestore | Out-Null
if (Test-Path $DbPath) {
  Copy-Item -Path $DbPath -Destination (Join-Path $preRestore 'smart-control.db') -Force
  Write-Host "[2/5] 当前 DB 已备份: $preRestore" -ForegroundColor Green
} else {
  Write-Host "[2/5] 当前 DB 不存在, 跳过备份" -ForegroundColor DarkYellow
}

# 3) 覆盖数据库
$dbDir = Split-Path -Parent $DbPath
if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Path $dbDir | Out-Null }
Copy-Item -Path $snapDb -Destination $DbPath -Force
Write-Host "[3/5] 数据库已恢复 → $DbPath" -ForegroundColor Green

# 4) (可选) backend\.env
if ($RestoreEnv -and (Test-Path $snapEnv)) {
  $envTarget = Join-Path $projectRoot 'backend\.env'
  Copy-Item -Path $envTarget -Destination (Join-Path $preRestore 'backend.env') -Force -ErrorAction SilentlyContinue
  Copy-Item -Path $snapEnv -Destination $envTarget -Force
  Write-Host "[4/5] backend\.env 已恢复" -ForegroundColor Green
} else {
  Write-Host "[4/5] backend\.env 未恢复 (未指定 -RestoreEnv 或快照中不存在)" -ForegroundColor DarkYellow
}

# 5) 重启 PM2
Write-Host "[5/5] 重启 PM2 ..." -ForegroundColor Yellow
& pm2 restart $ProcessName --update-env | Out-Null
Start-Sleep -Seconds 2

# 验收
Write-Host ""
Write-Host "=== 恢复完成 ===" -ForegroundColor Cyan
Write-Host " pre-restore 备份: $preRestore"
Write-Host " 建议: 调用 deploy\scripts\health.ps1 验证服务正常"
& pm2 status
