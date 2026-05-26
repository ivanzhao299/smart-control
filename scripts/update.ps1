# 现场更新脚本 (Windows 10 / GK9000)
# 把 cnjinhu.top 上已部署的最新代码同步到展厅本地主控机
#
# 用法:
#   .\scripts\update.ps1            # 标准: pull + build + reload
#   .\scripts\update.ps1 -SkipPull  # 跳过 git pull (代码已手动同步过)
#   .\scripts\update.ps1 -Hard      # 强制重启 (而非 reload), 慢但更彻底
#   .\scripts\update.ps1 -DryRun    # 只看会做什么, 不执行
#
# 安全机制:
#   1. 先备份 (调用 backup.ps1)
#   2. 工作区有未提交改动会拒绝运行 (除非 -Force)
#   3. 任何一步失败立即中止, .env 和数据库不会被动到
#   4. 失败后给出回滚命令

[CmdletBinding()]
param(
  [switch]$SkipPull,
  [switch]$Hard,
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

function Run($cmd) {
  Write-Host "  > $cmd" -ForegroundColor DarkGray
  if (-not $DryRun) {
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) {
      throw "命令失败 (exit=$LASTEXITCODE): $cmd"
    }
  }
}

Write-Host "================================================" -ForegroundColor Cyan
Write-Host " 现场主控机 - 增量更新" -ForegroundColor Cyan
Write-Host " 项目根: $projectRoot" -ForegroundColor Gray
if ($DryRun) { Write-Host " *** DRY RUN MODE - 不执行实际命令 ***" -ForegroundColor Yellow }
Write-Host "================================================" -ForegroundColor Cyan

# 0) 记录当前 commit, 用于失败回滚
$beforeCommit = (git rev-parse HEAD 2>$null)
Write-Host "`n[0/6] 当前版本: $beforeCommit" -ForegroundColor Gray

# 1) 检查工作区干净
Write-Host "`n[1/6] 检查工作区状态..." -ForegroundColor Yellow
$dirty = git status --porcelain
if ($dirty -and (-not $Force)) {
  Write-Host "  工作区有未提交修改:" -ForegroundColor Red
  $dirty | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
  Write-Host "  本地不应该有修改, 现场只接收云端代码. 如确认要继续, 加 -Force 参数" -ForegroundColor Red
  throw "工作区不干净, 拒绝更新"
}
Write-Host "  工作区干净 OK" -ForegroundColor Green

# 2) 备份 (数据库 + .env + UAT 快照)
Write-Host "`n[2/6] 更新前备份..." -ForegroundColor Yellow
$backupScript = Join-Path $projectRoot 'scripts\backup.ps1'
if (Test-Path $backupScript) {
  if (-not $DryRun) { & $backupScript -Keep 14 }
} else {
  Write-Host "  backup.ps1 不存在, 跳过备份 (风险自担)" -ForegroundColor Yellow
}

# 3) git pull
if (-not $SkipPull) {
  Write-Host "`n[3/6] 拉取最新代码..." -ForegroundColor Yellow
  Run "git fetch origin main"
  Run "git pull --ff-only origin main"
  $afterCommit = if ($DryRun) { 'N/A' } else { (git rev-parse HEAD) }
  if ($beforeCommit -eq $afterCommit) {
    Write-Host "  已是最新, 无变化. 退出." -ForegroundColor Green
    exit 0
  }
  Write-Host "  $beforeCommit -> $afterCommit" -ForegroundColor Green
} else {
  Write-Host "`n[3/6] 跳过 git pull (-SkipPull)" -ForegroundColor Gray
}

# 4) 安装/更新依赖 (只在 package.json 变化时)
Write-Host "`n[4/6] 检查依赖变化..." -ForegroundColor Yellow
$pkgChanged = git diff --name-only "$beforeCommit" HEAD 2>$null | Select-String -Pattern 'package(-lock)?\.json|pnpm-lock\.yaml'
if ($pkgChanged -or $Force) {
  Write-Host "  package 文件有变化, 重装依赖..." -ForegroundColor Yellow
  Push-Location (Join-Path $projectRoot 'backend')
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Run "pnpm install --frozen-lockfile"
  } else {
    Run "npm ci --no-audit --no-fund"
  }
  Pop-Location

  Push-Location (Join-Path $projectRoot 'frontend')
  if (Get-Command pnpm -ErrorAction SilentlyContinue) {
    Run "pnpm install --frozen-lockfile"
  } else {
    Run "npm ci --no-audit --no-fund"
  }
  Pop-Location
} else {
  Write-Host "  package 无变化, 跳过依赖安装" -ForegroundColor Green
}

# 5) 重新构建 (backend + frontend)
Write-Host "`n[5/6] 重新构建..." -ForegroundColor Yellow
Push-Location (Join-Path $projectRoot 'backend')
Run "npm run build"
Pop-Location

Push-Location (Join-Path $projectRoot 'frontend')
Run "npm run build"
Pop-Location
Write-Host "  构建完成" -ForegroundColor Green

# 6) PM2 reload / restart
Write-Host "`n[6/6] 重启服务..." -ForegroundColor Yellow
if ($Hard) {
  Run "pm2 restart smart-control-backend --update-env"
} else {
  Run "pm2 reload smart-control-backend --update-env"
}

# 健康检查
Write-Host "`n等待服务起来 (5s)..." -ForegroundColor Gray
if (-not $DryRun) { Start-Sleep -Seconds 5 }

Write-Host "`n健康检查..." -ForegroundColor Yellow
try {
  if (-not $DryRun) {
    $health = Invoke-RestMethod 'http://localhost:3000/api/system/health' -TimeoutSec 10
    if ($health.data.status -eq 'ok') {
      Write-Host "  ✓ 服务健康, 更新成功" -ForegroundColor Green
      Write-Host "    apiStatus    = $($health.data.apiStatus)"
      Write-Host "    dbStatus     = $($health.data.databaseStatus)"
      Write-Host "    deviceOnline = $($health.data.deviceOnlineCount)"
    } else {
      throw "健康检查返回非 ok 状态: $($health | ConvertTo-Json -Compress)"
    }
  }
}
catch {
  Write-Host "  ✗ 健康检查失败: $_" -ForegroundColor Red
  Write-Host "`n回滚命令:" -ForegroundColor Yellow
  Write-Host "  git reset --hard $beforeCommit" -ForegroundColor Yellow
  Write-Host "  cd backend && npm run build" -ForegroundColor Yellow
  Write-Host "  cd .. && cd frontend && npm run build" -ForegroundColor Yellow
  Write-Host "  pm2 restart smart-control-backend" -ForegroundColor Yellow
  throw
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host " 更新完成" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan

# 心跳上报: 让远端 (cnjinhu.top) 看到本机当前 commit / 时间, 远程运维不用 RDP 也能看到状态
if (-not $DryRun) {
  try {
    $headCommit = (git rev-parse HEAD).Trim()
    $pkgPath = Join-Path $projectRoot 'backend\package.json'
    $localVersion = if (Test-Path $pkgPath) { (Get-Content $pkgPath -Raw | ConvertFrom-Json).version } else { $null }
    $payload = @{
      host = $env:COMPUTERNAME
      commit = $headCommit
      ref = 'main'
      version = $localVersion
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    } | ConvertTo-Json -Compress

    # cnjinhu.top 有 nginx Basic Auth
    $authHeader = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("jinhu:jinhu2026"))
    $headers = @{
      Authorization = $authHeader
      'Content-Type' = 'application/json'
    }
    Invoke-RestMethod -Uri 'https://cnjinhu.top/control/api/system/site-heartbeat' `
      -Method Post -Headers $headers -Body $payload -TimeoutSec 8 | Out-Null
    Write-Host "  ✓ 心跳已报 ($($headCommit.Substring(0,7)))" -ForegroundColor Gray
  } catch {
    Write-Host "  ! 心跳上报失败 (不影响更新): $_" -ForegroundColor DarkGray
  }
}
