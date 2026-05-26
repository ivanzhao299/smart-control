# 查看日志
# 用法:
#   scripts\logs.ps1                跟随 PM2 流 (Ctrl+C 退出)
#   scripts\logs.ps1 -Err           只看 error.log
#   scripts\logs.ps1 -Tail 200      显示最近 200 行后退出
#   scripts\logs.ps1 -App           winston 应用日志 (今日)
[CmdletBinding()]
param(
  [switch]$Err,
  [switch]$App,
  [int]$Tail = 0
)

$ErrorActionPreference = 'Continue'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$logDir = if ($env:LOG_DIR) { $env:LOG_DIR } else { Join-Path $projectRoot 'logs' }

if ($App) {
  $today = Get-Date -Format 'yyyy-MM-dd'
  $appLog = Join-Path $logDir "app-$today.log"
  $errLog = Join-Path $logDir "error-$today.log"
  Write-Host "winston app log: $appLog" -ForegroundColor Cyan
  if (Test-Path $appLog) {
    if ($Tail -gt 0) { Get-Content -Path $appLog -Tail $Tail }
    else { Get-Content -Path $appLog -Wait -Tail 50 }
  } else {
    Write-Host "今日 winston 日志不存在: $appLog" -ForegroundColor Yellow
  }
  return
}

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 PM2, 改读文件..." -ForegroundColor Yellow
  $file = if ($Err) { Join-Path $logDir 'pm2-error.log' } else { Join-Path $logDir 'pm2-out.log' }
  if (Test-Path $file) {
    if ($Tail -gt 0) { Get-Content -Path $file -Tail $Tail }
    else { Get-Content -Path $file -Wait -Tail 50 }
  } else {
    Write-Host "日志文件不存在: $file" -ForegroundColor Red
  }
  return
}

if ($Tail -gt 0) {
  if ($Err) { pm2 logs smart-control-backend --err --lines $Tail --nostream }
  else { pm2 logs smart-control-backend --lines $Tail --nostream }
} else {
  if ($Err) { pm2 logs smart-control-backend --err }
  else { pm2 logs smart-control-backend }
}
