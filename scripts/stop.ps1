# 停止中控系统 (PM2 stop, 不卸载)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\stop.ps1 [-All]
[CmdletBinding()]
param(
  [switch]$All
)

$ErrorActionPreference = 'Continue'

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 PM2" -ForegroundColor Red
  exit 1
}

if ($All) {
  Write-Host "停止所有 PM2 进程..." -ForegroundColor Yellow
  pm2 stop all
} else {
  Write-Host "停止 smart-control-backend..." -ForegroundColor Yellow
  pm2 stop smart-control-backend
}

Write-Host "`n=== PM2 状态 ===" -ForegroundColor Cyan
pm2 list
