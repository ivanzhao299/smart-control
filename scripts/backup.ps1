# 数据库 + 配置备份
# 用法:
#   scripts\backup.ps1                            备份到 backups\YYYYMMDD-HHMMSS\
#   scripts\backup.ps1 -Dest 'E:\sc-backups'      指定根目录
#   历史快照不自动删除；本脚本不包含媒体文件，不是完整发布回滚快照。
[CmdletBinding()]
param(
  [string]$Dest = '',
  # Compatibility only. Retention now requires a separate explicit operation.
  [int]$Keep = 7
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

# 默认备份目录: 项目目录之外，避免被 git clean 删除
# 优先级: 环境变量 BACKUP_DIR > D:\smart-control-backups > 项目内backups（兼容旧版）
if ([string]::IsNullOrWhiteSpace($Dest)) {
  if ($env:BACKUP_DIR) {
    $Dest = $env:BACKUP_DIR
  } elseif (Test-Path 'D:\') {
    $Dest = 'D:\smart-control-backups'
  } else {
    $Dest = Join-Path $projectRoot 'backups'
  }
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

# 数据库：在线备份包含 WAL，校验失败必须中止，不允许退回文件复制。
$dbPath = if ($env:DB_PATH) { $env:DB_PATH } else { Join-Path $projectRoot 'database\smart-control.db' }
if (Test-Path $dbPath) {
  $backupTool = Join-Path $projectRoot 'backend\scripts\verified-sqlite-backup.cjs'
  Write-Host "[1/3] SQLite 在线备份及完整性校验..." -ForegroundColor Yellow
  $backupJson = & node $backupTool $dbPath $snap
  if ($LASTEXITCODE -ne 0) { throw 'Verified database backup failed; deployment must stop.' }
  $manifest = $backupJson | ConvertFrom-Json
  if ($manifest.integrity -ne 'ok' -or -not (Test-Path $manifest.snapshot)) {
    throw 'Verified database backup returned invalid evidence.'
  }
  $dbDest = $manifest.snapshot
  $size = [math]::Round((Get-Item $dbDest).Length / 1KB, 1)
  Write-Host "      saved: $dbDest ($size KB)" -ForegroundColor Green
} else {
  throw "数据库不存在，不能建立发布备份: $dbPath"
}

# .env (敏感, 但备份保留 → 备份目录权限自管)
$envFile = Join-Path $projectRoot 'backend\.env'
if (Test-Path $envFile) {
  Copy-Item -Path $envFile -Destination (Join-Path $snap 'backend.env') -Force
  Write-Host "[2/3] backend\.env 已备份" -ForegroundColor Green
} else {
  Write-Host "[2/3] backend\.env 不存在, 跳过" -ForegroundColor DarkYellow
}

# 现场可写运行时业务/设备数据 (KPI、视频绑定+AI 计数线/ROI、播控状态) 必须与数据库一起备份,
# 否则会重演 2026-09-15 "部署后 KPI/AI 框丢失且无备份可恢复"。路径解析与
# deploy/ecosystem.config.js、deploy-from-ci.ps1 保持一致; 同时兜底备份旧的仓库内
# backend\data。纯复制、去重、目录不存在或无 json 时跳过。
$runtimeDirs = @()
if ($env:DATA_DIR) { $runtimeDirs += $env:DATA_DIR }
if (Test-Path 'D:\') { $runtimeDirs += 'D:\smart-control-runtime\data' }
$runtimeDirs += (Join-Path $projectRoot '.runtime\data')
$runtimeDirs += (Join-Path $projectRoot 'backend\data')
$seenRuntime = @{}
foreach ($rd in $runtimeDirs) {
  if ([string]::IsNullOrWhiteSpace($rd)) { continue }
  if (-not (Test-Path $rd)) { continue }
  $runtimeKey = (Resolve-Path $rd).Path.TrimEnd('\').ToLower()
  if ($seenRuntime.ContainsKey($runtimeKey)) { continue }
  $seenRuntime[$runtimeKey] = $true
  $runtimeJson = @(Get-ChildItem -Path $rd -Filter *.json -File -ErrorAction SilentlyContinue)
  if ($runtimeJson.Count -eq 0) { continue }
  $runtimeLabel = if ($rd -like '*backend\data') { 'legacy-backend-data' } else { 'runtime-data' }
  $runtimeSnap = Join-Path $snap $runtimeLabel
  New-Item -ItemType Directory -Force -Path $runtimeSnap | Out-Null
  Copy-Item (Join-Path $rd '*') $runtimeSnap -Recurse -Force -ErrorAction SilentlyContinue
  Write-Host "Runtime config backed up: $rd -> $runtimeLabel ($($runtimeJson.Count) json)" -ForegroundColor Green
}

# Seed (UAT 数据用过的可保留)
$uatExport = Join-Path $snap 'uat-snapshot.json'
try {
  # Port 3200 - production backend listens on 3200. The old 3000 was an early port and
  # had been silently falling into the catch branch ever since (every backup printed
  # "UAT export skipped", which looked like the service was down but was just a bad port).
  $uat = Invoke-RestMethod -Uri 'http://127.0.0.1:3200/api/uat?pageSize=500' -Method Get -TimeoutSec 5
  $uat | ConvertTo-Json -Depth 10 | Out-File -FilePath $uatExport -Encoding utf8
  Write-Host "[3/3] UAT 验收快照已导出 (服务运行中)" -ForegroundColor Green
} catch {
  Write-Host "[3/3] UAT 导出跳过 (服务未运行或接口不可达)" -ForegroundColor DarkYellow
}

# 不自动清理：保留迁移前后恢复证据，Keep 参数仅兼容旧调用。
Write-Host '历史备份均保留；此快照未包含媒体文件，不能单独作为完整回滚依据。' -ForegroundColor Yellow

Write-Host "`n=== 备份完成 ===" -ForegroundColor Cyan
Get-ChildItem -Path $Dest -Directory | Sort-Object Name -Descending | Select-Object -First 5 |
  Format-Table Name, LastWriteTime, @{N='SizeMB'; E={ [math]::Round((Get-ChildItem $_.FullName -Recurse | Measure-Object Length -Sum).Sum / 1MB, 2) }}
