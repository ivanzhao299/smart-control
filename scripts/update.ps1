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

# 注意: 不要用 'Stop' — git 等 native command 会把正常 stderr ("From github.com:...")
# 也算 error, PS 直接抛 RemoteException 把脚本掀掉. 改 Continue 后只看 $LASTEXITCODE.
$ErrorActionPreference = 'Continue'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

function Run($cmd) {
  Write-Host "  > $cmd" -ForegroundColor DarkGray
  if (-not $DryRun) {
    # 把 stderr 合并到 stdout — 即使 native command 在 stderr 写正常进度也不会被当 error 抛
    Invoke-Expression "$cmd 2>&1" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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

# 1) 检查工作区干净 — 只阻塞 tracked-modified, untracked 无害放行
# (现场会有 backend/dist / logs / tmp / *.bak / npmrc 等本地产物, 一刀切 throw 会
# 让自治链路死锁: update.ps1 抛 dirty → watcher 抓 → 拉不到新 update.ps1.)
Write-Host "`n[1/6] 检查工作区状态..." -ForegroundColor Yellow
$dirty = git status --porcelain
if ($dirty) {
  $tracked = @($dirty | Where-Object { $_ -notmatch '^\?\?' })
  $untracked = @($dirty | Where-Object { $_ -match '^\?\?' })
  if ($untracked.Count -gt 0) {
    Write-Host "  忽略 $($untracked.Count) 个 untracked 文件 (pull 不会动它们)" -ForegroundColor DarkGray
  }
  if ($tracked.Count -gt 0 -and -not $Force) {
    Write-Host "  tracked 文件被改过:" -ForegroundColor Red
    $tracked | ForEach-Object { Write-Host "    $_" -ForegroundColor Red }
    Write-Host "  pull 可能冲突. 加 -Force 强制覆盖, 或先 git stash" -ForegroundColor Yellow
    throw "工作区 tracked 文件不干净, 拒绝更新"
  }
  if ($tracked.Count -gt 0) {
    Write-Host "  -Force 模式: 忽略 $($tracked.Count) 个 tracked-modified 文件, 强行 pull" -ForegroundColor Yellow
  }
} else {
  Write-Host "  工作区干净 OK" -ForegroundColor Green
}

# 2) git pull (顺序重要: 先 pull 再 backup, 这样 backup.ps1 等子脚本永远是最新版.
#    之前先 backup 后 pull, 一旦 backup.ps1 本身有问题 (e.g. BOM 缺失 parse 错),
#    update 就死在第一步, pull 永远跑不到 — 出过现场鸡生蛋死锁, 别再倒回去)
if (-not $SkipPull) {
  Write-Host "`n[2/6] 拉取最新代码..." -ForegroundColor Yellow
  Run "git fetch origin main"
  Run "git pull --ff-only origin main"
  $afterCommit = if ($DryRun) { 'N/A' } else { (git rev-parse HEAD) }
  if ($beforeCommit -eq $afterCommit) {
    Write-Host "  已是最新, 无变化. 退出." -ForegroundColor Green
    exit 0
  }
  Write-Host "  $beforeCommit -> $afterCommit" -ForegroundColor Green
} else {
  Write-Host "`n[2/6] 跳过 git pull (-SkipPull)" -ForegroundColor Gray
}

# 3) 备份 (数据库 + .env + UAT 快照). 失败只警告不阻塞 — backup 不是 update 的硬依赖,
#    update 失败可以靠 git reset --hard $beforeCommit 回滚源码, 数据库本身 build/pm2
#    reload 不会动. backup 价值是 "万一你想恢复到 update 前的数据库快照".
Write-Host "`n[3/6] 更新前备份..." -ForegroundColor Yellow
$backupScript = Join-Path $projectRoot 'scripts\backup.ps1'
if (Test-Path $backupScript) {
  if (-not $DryRun) {
    try {
      & $backupScript -Keep 14
    } catch {
      Write-Host "  ! backup.ps1 失败 (继续 update, 不阻塞): $_" -ForegroundColor Yellow
    }
  }
} else {
  Write-Host "  backup.ps1 不存在, 跳过备份" -ForegroundColor Yellow
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

# 4.5) .env 一次性修复 — 2026-05-27 我用 RDC Notepad 不小心把 DALI_RTU_HOST
# 改成了 192.168.0.7 (USR 出厂默认 IP), 但用户后来把 USR IP 改回了 192.168.50.20,
# 现在 .env 跟 USR 实际 IP 对不上, gateway 一直 offline. 这块只针对那个错值,
# 不会动用户主动设的别的 IP — 安全且幂等.
$envFile = Join-Path $projectRoot 'backend\.env'
if (Test-Path $envFile) {
  $envText = Get-Content $envFile -Raw
  if ($envText -match 'DALI_RTU_HOST\s*=\s*192\.168\.0\.7') {
    Write-Host "`n[env-repair] 发现 DALI_RTU_HOST=192.168.0.7, 改回 192.168.50.20..." -ForegroundColor Yellow
    $newText = $envText -replace 'DALI_RTU_HOST\s*=\s*192\.168\.0\.7', 'DALI_RTU_HOST=192.168.50.20'
    Set-Content -Path $envFile -Value $newText -NoNewline
    Write-Host "  ok" -ForegroundColor Green
  }
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

# 5.5) seed — 应用 entity / 硬件 / 场景的更新.
# seed 本身是幂等的 (record 已存在就跳过), 安全多跑.
# 例外: 末尾的 HW_IP_FIXES 段会把错的 IP 主动更新成正确值 (一次性自愈).
Write-Host "`n[5.5/6] 应用 seed (硬件/场景/设备 idempotent 更新)..." -ForegroundColor Yellow
Push-Location (Join-Path $projectRoot 'backend')
Run "npm run seed"
Pop-Location

# 6) PM2 restart — 强制 hard restart, 而非 reload.
# 之前用 reload 发现过 backend 跑的是几小时前的旧 dist (新 endpoint 全 404),
# 怀疑 reload 在某些情形下保留旧进程 / 旧 require 缓存. restart 是最干净的:
# 杀掉旧进程, 重新 require dist/main.js, 不可能保留任何旧状态.
Write-Host "`n[6/6] 重启服务 (pm2 restart, 强制全新进程)..." -ForegroundColor Yellow
Run "pm2 restart smart-control-backend --update-env"

# 健康检查 — 多端口探测 (生产 3200 / 开发 3000), 不再硬编码
Write-Host "`n等待服务起来 (5s)..." -ForegroundColor Gray
if (-not $DryRun) { Start-Sleep -Seconds 5 }

Write-Host "`n健康检查..." -ForegroundColor Yellow
$healthOk = $false
$lastErr = $null
foreach ($port in @(3200, 3000)) {
  if ($DryRun) { $healthOk = $true; break }
  try {
    $health = Invoke-RestMethod "http://localhost:$port/api/system/health" -TimeoutSec 10 -ErrorAction Stop
    if ($health.data.status -eq 'ok') {
      Write-Host "  ✓ 服务健康 @ :$port, 更新成功" -ForegroundColor Green
      Write-Host "    apiStatus    = $($health.data.apiStatus)"
      Write-Host "    dbStatus     = $($health.data.databaseStatus)"
      Write-Host "    deviceOnline = $($health.data.deviceOnlineCount)"
      $healthOk = $true
      break
    } else {
      $lastErr = "返回非 ok: $($health | ConvertTo-Json -Compress)"
    }
  } catch {
    $lastErr = "端口 $port 不可达: $($_.Exception.Message)"
  }
}
if (-not $healthOk) {
  Write-Host "  ✗ 健康检查全部端口失败: $lastErr" -ForegroundColor Red
  Write-Host "`n回滚命令:" -ForegroundColor Yellow
  Write-Host "  git reset --hard $beforeCommit" -ForegroundColor Yellow
  Write-Host "  pm2 restart smart-control-backend" -ForegroundColor Yellow
  throw "健康检查失败: $lastErr"
}

Write-Host "`n================================================" -ForegroundColor Cyan
Write-Host " 更新完成" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Cyan

# 心跳已移到 watcher 里 (finally 块), 每次轮询都报, 不只 update 成功时
# update.ps1 本身不再单独报 — 避免重复
