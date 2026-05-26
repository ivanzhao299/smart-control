# 启动中控系统 (Windows 10 / GK9000)
# 用法: powershell -ExecutionPolicy Bypass -File scripts\start.ps1 [-Env production|development]
[CmdletBinding()]
param(
  [ValidateSet('production', 'development')]
  [string]$Env = 'production'
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " 启动 smart-control-backend [$Env]" -ForegroundColor Cyan
Write-Host " 项目根: $projectRoot" -ForegroundColor Gray
Write-Host "================================================" -ForegroundColor Cyan

# 1) 确保依赖已装
$nodeModules = Join-Path $projectRoot 'backend\node_modules'
if (-not (Test-Path $nodeModules)) {
  Write-Host "`n[1/3] node_modules 不存在, 安装依赖..." -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'backend')
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm install --frozen-lockfile
  } else {
    npm ci --no-audit --no-fund
  }
  Pop-Location
} else {
  Write-Host "`n[1/3] node_modules 已存在, 跳过安装" -ForegroundColor Green
}

# 2) build dist
$dist = Join-Path $projectRoot 'backend\dist'
if (-not (Test-Path (Join-Path $dist 'main.js'))) {
  Write-Host "[2/3] 编译 backend (dist 不存在)" -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'backend')
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    pnpm build
  } else {
    npm run build
  }
  Pop-Location
} else {
  Write-Host "[2/3] dist/main.js 已存在, 跳过编译 (若有源码修改请先运行 scripts\restart.ps1 -Build)" -ForegroundColor Green
}

# 3) 启动 PM2
$ecosystem = Join-Path $projectRoot 'deploy\ecosystem.config.js'
$pm2 = Get-Command pm2 -ErrorAction SilentlyContinue
if (-not $pm2) {
  Write-Host "未检测到 PM2, 请先 'npm install -g pm2'" -ForegroundColor Red
  exit 1
}

Write-Host "[3/3] PM2 启动" -ForegroundColor Yellow
pm2 describe smart-control-backend *>$null
if ($LASTEXITCODE -eq 0) {
  pm2 reload smart-control-backend --update-env
} else {
  pm2 start $ecosystem --env $Env
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
  Write-Host "请检查 pm2 logs smart-control-backend"
}
