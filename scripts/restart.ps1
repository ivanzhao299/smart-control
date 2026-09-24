# 重启中控系统
# 用法:
#   scripts\restart.ps1                   平滑重启 (PM2 reload)
#   scripts\restart.ps1 -Hard             强制重启
#   scripts\restart.ps1 -Build            先重新编译后重启
[CmdletBinding()]
param(
  [switch]$Hard,
  [switch]$Build
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

if (-not (Get-Command pm2 -ErrorAction SilentlyContinue)) {
  Write-Host "未检测到 PM2, 请先 'npm install -g pm2'" -ForegroundColor Red
  exit 1
}

if ($Build) {
  if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    throw '未检测到 pnpm。请先安装项目声明的 pnpm@10.33.4。'
  }
  Write-Host "[build] 编译 backend..." -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'backend')
  pnpm build
  Pop-Location
}

if ($Hard) {
  Write-Host "[restart] PM2 restart (强制)..." -ForegroundColor Yellow
  pm2 restart smart-control-backend --update-env
} else {
  Write-Host "[reload] PM2 reload (平滑)..." -ForegroundColor Yellow
  pm2 reload smart-control-backend --update-env
}
pm2 save

Start-Sleep -Seconds 2
Write-Host "`n=== PM2 状态 ===" -ForegroundColor Cyan
pm2 list

Write-Host "`n=== 健康检查 ===" -ForegroundColor Cyan
try {
  $resp = Invoke-RestMethod -Uri 'http://127.0.0.1:3000/api/system/health' -Method Get -TimeoutSec 5
  $resp | ConvertTo-Json -Depth 6
} catch {
  Write-Host "健康检查失败: $($_.Exception.Message)" -ForegroundColor Red
}
