# 现场主控机自动追主分支 (GK9000 等)
# 每次跑: git fetch + 比较 HEAD vs origin/main, 落后就调 update.ps1
#
# 用法 (手动调试):
#   .\scripts\auto-update-watcher.ps1
#   .\scripts\auto-update-watcher.ps1 -DryRun       # 只看, 不更新
#   .\scripts\auto-update-watcher.ps1 -Verbose      # 详细日志
#
# 注册成 Windows 计划任务 (轮询):
#   .\scripts\install-auto-update-task.ps1
#
# 日志: logs\auto-update.log (按日 rotate)
# 锁文件: tmp\auto-update.lock (避免上一次没跑完又触发)

[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Force
)

# 关键: 不要用 'Stop' — 这会让 native command (git) 的 stderr 把整个脚本掀掉,
# 自己用 $LASTEXITCODE 显式判断更可控. 致命情况下层用 throw + 顶层 try/catch 兜.
$ErrorActionPreference = 'Continue'

# 路径解析: $PSScriptRoot 在某些 PS 配置 / Task Scheduler 下可能为空, 兜底用
# MyInvocation. 计算错了会把 logs 写到 D:\logs\ 而不是 D:\smart-control\logs\.
$scriptDir = if ($PSScriptRoot) { $PSScriptRoot } else { Split-Path -Parent $MyInvocation.MyCommand.Definition }
$projectRoot = (Resolve-Path (Join-Path $scriptDir '..')).Path
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot 'logs'
$tmpDir = Join-Path $projectRoot 'tmp'
foreach ($d in @($logsDir, $tmpDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$logFile = Join-Path $logsDir ("auto-update-" + (Get-Date -Format 'yyyyMMdd') + ".log")
$lockFile = Join-Path $tmpDir 'auto-update.lock'

function Log($msg, $color = 'Gray') {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "[$ts] $msg"
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction Stop } catch { }
  try { Write-Host $line -ForegroundColor $color } catch { }
}

# 启动哨兵 — 任何情况下先证明 "我跑起来了, projectRoot 是 X"
Log ("=== watcher 启动 (pid=$PID, projectRoot=$projectRoot, user=$env:USERNAME) ===") 'Cyan'

# 计划任务跑出来的 PowerShell 有时 PATH 不带 git/node/pnpm, 主动补一遍
$extraPaths = @(
  "$env:ProgramFiles\Git\cmd",
  "$env:ProgramFiles\Git\bin",
  "${env:ProgramFiles(x86)}\Git\cmd",
  "$env:LOCALAPPDATA\Programs\Git\cmd",
  "$env:ProgramFiles\nodejs",
  "$env:APPDATA\npm",
  "$env:LOCALAPPDATA\pnpm"
)
foreach ($p in $extraPaths) {
  if ($p -and (Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
    $env:PATH = "$p;$env:PATH"
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Log "git 不在 PATH 也不在标准位置 (Program Files\Git, LocalAppData\Programs\Git). 装一下 Git for Windows 再重试" 'Red'
  exit 2
}

# 锁: 上一次 update 可能还在跑 (build 几十秒), 不要叠加
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 15) {
    Log "skip: 上一次更新仍在跑 (锁文件 $([int]$lockAge.TotalSeconds)s 前创建)" 'Yellow'
    exit 0
  }
  Log "warn: 发现 $([int]$lockAge.TotalMinutes) 分钟前的陈旧锁, 清理" 'Yellow'
  Remove-Item $lockFile -Force
}

try {
  # 工作区脏检查: 区分 untracked (??) 和 tracked-modified
  # - 现场常有本地脚本 / .env / .bak 文件 (untracked), 不影响 pull → 放行
  # - tracked-modified (M/D/A/R) 才可能跟远端冲突 → 警告但仍尝试
  #   (用 update.ps1 里的 git pull --ff-only 顶住, 真冲突它会自己 fail)
  $dirty = git status --porcelain 2>&1
  if ($LASTEXITCODE -ne 0) {
    # 自愈: dubious ownership 是常见现场问题 — 试着给当前用户加 safe.directory 再重试一次
    if ("$dirty" -match 'dubious ownership') {
      $safePath = $projectRoot -replace '\\', '/'
      Log "检测到 dubious ownership, 自动加 user-level safe.directory: $safePath" 'Yellow'
      git config --global --add safe.directory $safePath 2>&1 | Out-Null
      $dirty = git status --porcelain 2>&1
    }
    if ($LASTEXITCODE -ne 0) {
      Log "git status 失败 (exit=$LASTEXITCODE): $dirty" 'Red'
      Log "cwd=$((Get-Location).Path), 检查 projectRoot 或重跑 install (admin)" 'Red'
      exit 3
    }
  }
  if ($dirty -and -not $Force) {
    $tracked = $dirty | Where-Object { $_ -notmatch '^\?\?' }
    $untracked = $dirty | Where-Object { $_ -match '^\?\?' }
    if ($untracked) {
      Write-Verbose "ignore untracked: $($untracked.Count) 个 (不阻塞 pull)"
    }
    if ($tracked) {
      Log "warn: 有 tracked 文件被现场改过, 尝试 pull (--ff-only 会自己处理冲突):" 'Yellow'
      $tracked | ForEach-Object { Log "  $_" 'Yellow' }
      Log "tip: 配置类文件 (.env*) 应该跑一次 git update-index --skip-worktree 永久豁免" 'DarkGray'
    }
  }

  # 1) 拉远端最新引用 (不动工作区)
  $fetchOut = (git fetch origin main 2>&1) -join "`n"
  if ($LASTEXITCODE -ne 0) {
    Log "fetch failed (exit=$LASTEXITCODE): $fetchOut" 'Red'
    exit 1
  }

  # 2) 比较本地 vs 远端
  $local = (git rev-parse HEAD 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not $local) { Log "rev-parse HEAD 失败: $local" 'Red'; exit 4 }
  $local = ($local | Out-String).Trim()

  $remote = (git rev-parse origin/main 2>&1)
  if ($LASTEXITCODE -ne 0 -or -not $remote) { Log "rev-parse origin/main 失败: $remote" 'Red'; exit 4 }
  $remote = ($remote | Out-String).Trim()

  if ($local -eq $remote) {
    Log "up-to-date @ $($local.Substring(0,7))" 'DarkGray'
    exit 0
  }

  $behind = ((git rev-list --count "$local..$remote") | Out-String).Trim()
  Log "new commit(s): 本地 $($local.Substring(0,7)) → 远端 $($remote.Substring(0,7)) (落后 $behind 个)" 'Cyan'

  if ($DryRun) {
    Log "dry-run: 不实际调 update.ps1" 'Yellow'
    git log --oneline "$local..$remote" | ForEach-Object { Log "  $_" 'Gray' }
    exit 0
  }

  # 3) 上锁后调 update.ps1
  Set-Content -Path $lockFile -Value (Get-Date -Format 'o')
  Log "running update.ps1..." 'Green'

  $updateScript = Join-Path $projectRoot 'scripts\update.ps1'
  & $updateScript 2>&1 | ForEach-Object {
    Log "  $_" 'DarkGray'
  }

  if ($LASTEXITCODE -ne 0) {
    Log "update.ps1 failed (exit=$LASTEXITCODE)" 'Red'
    exit $LASTEXITCODE
  }

  $after = ((git rev-parse HEAD) | Out-String).Trim()
  Log "OK: 已更新到 $($after.Substring(0,7))" 'Green'
} catch {
  Log "UNCAUGHT EXCEPTION: $($_.Exception.GetType().Name): $($_.Exception.Message)" 'Red'
  Log "  at: $($_.InvocationInfo.PositionMessage -replace '\r?\n','  ')" 'Red'
  $watcherError = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
  exit 99
} finally {
  if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }

  # 心跳: 不管 update 成不成, 每次跑完都向云端报一次. 这样远程能看到 watcher 活着,
  # 即使 update 链路挂了也能定位是哪一步.
  try {
    # PS 5.x 默认 TLS 1.0/1.1, cnjinhu 走 HTTPS 要 1.2+ — 强制一下
    [System.Net.ServicePointManager]::SecurityProtocol = `
      [System.Net.ServicePointManager]::SecurityProtocol -bor `
      [System.Net.SecurityProtocolType]::Tls12

    $hbHead = try { (git rev-parse HEAD 2>$null | Out-String).Trim() } catch { 'unknown' }
    $hbStatus = if ($watcherError) { "error: $watcherError" } else { "ok" }

    # 顺手查一下本机 backend 的 DALI 自检 (新 endpoint, 旧版本会 404, 静默忽略)
    $diag = $null
    try {
      $diag = Invoke-RestMethod -Uri 'http://localhost:3000/api/system/dali-selftest' `
        -Method Get -TimeoutSec 5 -ErrorAction Stop
      $diag = $diag.data
    } catch {
      # backend 未起 / 旧版本没这个 endpoint / 网络挂 — 都不影响心跳本身
      $diag = @{ error = "selftest 不可达: $($_.Exception.Message)" }
    }

    $hbPayload = @{
      host = $env:COMPUTERNAME
      commit = $hbHead
      ref = 'main'
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
      version = $hbStatus  # 借用 version 字段携带 watcher 状态 (够诊断用)
      diagnostics = $diag
    } | ConvertTo-Json -Compress -Depth 6

    $hbAuth = "Basic " + [Convert]::ToBase64String([Text.Encoding]::ASCII.GetBytes("jinhu:jinhu2026"))
    Invoke-RestMethod -Uri 'https://cnjinhu.top/control/api/system/site-heartbeat' `
      -Method Post `
      -Headers @{ Authorization = $hbAuth; 'Content-Type' = 'application/json' } `
      -Body $hbPayload -TimeoutSec 8 | Out-Null
    Log "heartbeat → cnjinhu (commit=$($hbHead.Substring(0,[Math]::Min(7,$hbHead.Length))), status=$hbStatus)" 'DarkGray'
  } catch {
    Log "heartbeat 上报失败: $($_.Exception.Message)" 'Yellow'
  }
}
