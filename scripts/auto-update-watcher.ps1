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
& (Join-Path $scriptDir 'assert-release-not-held.ps1') -ReleaseProjectRoot $projectRoot
if (-not $?) { exit 1 }

# 关键 (2026-07-26): 固定 PM2_HOME, 和 boot-pm2.ps1 保持一致。
# 根因: 本脚本作为计划任务在非交互会话跑, $env:USERPROFILE 为空, 下面的
# `& pm2 jlist` 会用 pm2 的默认家目录 (跟 boot-pm2 的 C:\Users\user\.pm2 不是
# 同一个), 找不到 boot 起的守护 -> 每轮 (~90s) spawn 一个孤儿 pm2 daemon。
# 几小时堆到几十个, 把句柄/内存/进程创建资源耗尽, 整机卡死到连 shutdown 都
# spawn 不出来 (2026-07-25 现场就是这样被拖死、只能物理断电)。设成同一个家目录,
# pm2 命令就复用那唯一的守护, 不再泄漏。
$env:PM2_HOME = 'C:\Users\user\.pm2'

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
    $script:exitCode = 1
    # 不 exit, 让控制流落到下面的 heartbeat 段, 不然 PS 5.1 会把 heartbeat 跳过
  }

  if (-not $script:exitCode) {
    # 2) 比较本地 vs 远端
    $local = (git rev-parse HEAD 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not $local) { Log "rev-parse HEAD 失败: $local" 'Red'; $script:exitCode = 4 }
    else { $local = ($local | Out-String).Trim() }
  }

  if (-not $script:exitCode) {
    $remote = (git rev-parse origin/main 2>&1)
    if ($LASTEXITCODE -ne 0 -or -not $remote) { Log "rev-parse origin/main 失败: $remote" 'Red'; $script:exitCode = 4 }
    else { $remote = ($remote | Out-String).Trim() }
  }

  if (-not $script:exitCode) {
    # 防陷阱: 即使 git up-to-date, 也得检查 dist/main.js 是不是从最新 commit 编出来的.
    # 现场遇到过: 用户手动重启 GK9000, pm2 用老 dist 拉起 backend, watcher 后续轮询
    # 看到 git up-to-date 就不再 build, 结果代码到位但 backend 跑老 dist (新 endpoint 全 404).
    $distMain = Join-Path $projectRoot 'backend\dist\main.js'
    $needForceRebuild = $false
    if ($local -eq $remote -and (Test-Path $distMain)) {
      try {
        $distMtimeUtc = (Get-Item $distMain).LastWriteTimeUtc
        # 最新 commit 的提交时间 (UTC, ISO-8601)
        $commitTimeStr = (git show -s --format=%cI HEAD 2>$null | Out-String).Trim()
        if ($commitTimeStr) {
          $commitTime = [DateTime]::Parse($commitTimeStr).ToUniversalTime()
          if ($distMtimeUtc -lt $commitTime) {
            Log "dist 比最新 commit 旧 (dist=$($distMtimeUtc.ToString('o')) commit=$($commitTime.ToString('o'))), 强制 rebuild" 'Yellow'
            $needForceRebuild = $true
          }
        }
      } catch { }
    }

    if ($local -eq $remote -and -not $needForceRebuild) {
      Log "up-to-date @ $($local.Substring(0,7))" 'DarkGray'
      # 不 exit — 落到 heartbeat 段把状态报上去
    } else {
      if ($needForceRebuild) {
        Log "force-rebuild: dist 落后于 commit $($local.Substring(0,7))" 'Cyan'
      } else {
        $behind = ((git rev-list --count "$local..$remote") | Out-String).Trim()
        Log "new commit(s): 本地 $($local.Substring(0,7)) → 远端 $($remote.Substring(0,7)) (落后 $behind 个)" 'Cyan'
      }

      if ($DryRun) {
        Log "dry-run: 不实际调 update.ps1" 'Yellow'
        git log --oneline "$local..$remote" | ForEach-Object { Log "  $_" 'Gray' }
      } else {
        # 3) 上锁后调 update.ps1
        Set-Content -Path $lockFile -Value (Get-Date -Format 'o')
        Log "running update.ps1..." 'Green'

        $updateScript = Join-Path $projectRoot 'scripts\update.ps1'
        # -Force: watcher 已经分别处理过 untracked / tracked-modified, update.ps1 的
        # dirty 守卫会因 pnpm-lock / npm 缓存等小修改 throw "工作区不干净, 拒绝更新",
        # 现场场景下没意义, 跳过.
        & $updateScript -Force 2>&1 | ForEach-Object {
          Log "  $_" 'DarkGray'
        }

        if ($LASTEXITCODE -ne 0) {
          Log "update.ps1 failed (exit=$LASTEXITCODE)" 'Red'
          $script:exitCode = $LASTEXITCODE
        } else {
          $after = ((git rev-parse HEAD) | Out-String).Trim()
          Log "OK: 已更新到 $($after.Substring(0,7))" 'Green'
        }
      }
    }
  }
} catch {
  Log "UNCAUGHT EXCEPTION: $($_.Exception.GetType().Name): $($_.Exception.Message)" 'Red'
  Log "  at: $($_.InvocationInfo.PositionMessage -replace '\r?\n','  ')" 'Red'
  $watcherError = "$($_.Exception.GetType().Name): $($_.Exception.Message)"
  $script:exitCode = 99
}

# 锁清理 + 心跳上报 — 不放在 finally 里, 因为 PS 5.x 的 'exit' 会跳过 finally,
# 把它移到 try/catch 之后的常规代码, 保证不管成败都跑完心跳再退出.
if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }

try {
  # PS 5.x 默认 TLS 1.0/1.1, cnjinhu 走 HTTPS 要 1.2+ — 强制一下
  [System.Net.ServicePointManager]::SecurityProtocol = `
    [System.Net.ServicePointManager]::SecurityProtocol -bor `
    [System.Net.SecurityProtocolType]::Tls12

  $hbHead = try { (git rev-parse HEAD 2>$null | Out-String).Trim() } catch { 'unknown' }
  $hbStatus = if ($watcherError) { "error: $watcherError" } else { "ok" }

  # 探 backend 健康状态: 试常见端口 (3000 prod / 3200 cnjinhu), 每个先 /system/info
  # 验活 (返回 mockMode + port), 然后再调 /dali-selftest. 全部用 ASCII 报告避免中文乱码.
  # 顺手收集 dist/main.js mtime, 帮判断"代码到了但进程没换".
  # pm2 jlist 之前也带过, 但深嵌套对象经 ConvertTo-Json -Depth 6 偶发产出非法 JSON
  # (cnjinhu backend 报 "Expected ',' or '}' after property value in JSON at position 439"),
  # 心跳整体被拒 400 → 远端永远看不到状态. 简化掉, 改成只发关键标量.
  $procInfo = @{ distMain = $null; distMainMtime = $null; distMainAgeSec = $null; pm2Status = $null; pm2Restarts = $null }
  # 【2026-07-26 根治泄漏】绝不在这里调用 `& pm2 jlist`。
  # 根因: boot-pm2.ps1 用 WMI Win32_Process.Create 把 pm2 守护"脱离"启动 (刻意为之,
  # 免得守护随会话死)。但 pm2 CLI 在 Windows 上靠命名管道找守护, 而管道是按会话
  # 隔离的 —— watcher 这个计划任务在另一个会话里跑 `pm2 jlist`, 看不见那个脱离的
  # 守护, 于是每次都 fork 一个自己的新守护。watcher 每 ~90s 一轮 = 每 90s 泄漏一个
  # 孤儿 pm2 daemon, 几小时堆到几十个, 句柄/进程创建资源耗尽把整机拖死 (2026-07-25
  # 现场卡到连 shutdown 都 spawn 不出来, 只能物理断电)。设 PM2_HOME 也堵不住 ——
  # 跨会话管道问题跟家目录无关。
  # 诊断字段改用"不 spawn 任何进程"的方式拿: 直接探端口判断后端在不在。
  try {
    $listening = [bool](Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
    $procInfo.pm2Status = if ($listening) { 'backend-listening' } else { 'backend-down' }
  } catch { $procInfo.pm2Status = 'probe-error' }

  # 直接枚举所有 node.exe 进程 — 不依赖 pm2 daemon 是否健康。
  # 2026-07-25: 只留前 15 个 + 总数。之前不设上限, 僵尸 node 堆积几十个时,
  # 加上下面的连接表, 心跳 payload 超过 cnjinhu backend 的 100KB json 上限,
  # 被 "request entity too large" (500) 拒收 —— 心跳连续失败, 远端全盲。
  $procInfo.nodeProcs = @()
  try {
    $allNodes = @(Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction Stop)
    $procInfo.nodeProcCount = $allNodes.Count
    foreach ($n in ($allNodes | Select-Object -First 15)) {
      $ownerName = 'unknown'
      try { $ownerName = $n.GetOwner().User } catch { }
      $cmdLine = $null
      if ($n.CommandLine) {
        $maxLen = [Math]::Min(140, $n.CommandLine.Length)
        $cmdLine = $n.CommandLine.Substring(0, $maxLen)
      }
      $procInfo.nodeProcs += @{ pid = $n.ProcessId; owner = $ownerName; cmd = $cmdLine }
    }
  } catch { $procInfo.nodeProcsErr = $_.Exception.Message }

  # 看实际谁在监听 :3200 — 只报 Listen 态。全量连接表是之前 payload 爆炸的
  # 主犯: PWA 轮询让 3200 上常挂着成百上千个 TIME_WAIT, 全塞进心跳毫无意义。
  $procInfo.port3200 = @()
  try {
    $conns = @(Get-NetTCPConnection -LocalPort 3200 -ErrorAction Stop)
    $procInfo.port3200ConnCount = $conns.Count
    foreach ($c in ($conns | Where-Object { $_.State -eq 'Listen' })) {
      $procInfo.port3200 += @{ pid = $c.OwningProcess; state = $c.State.ToString(); localAddr = $c.LocalAddress }
    }
  } catch { $procInfo.port3200Err = $_.Exception.Message }
  try {
    $distMain = Join-Path $projectRoot 'backend\dist\main.js'
    if (Test-Path $distMain) {
      $f = Get-Item $distMain
      $procInfo.distMain = $distMain.Replace('\','/')
      $procInfo.distMainMtime = $f.LastWriteTimeUtc.ToString('o')
      $procInfo.distMainAgeSec = [int]((Get-Date).ToUniversalTime() - $f.LastWriteTimeUtc).TotalSeconds
    }
  } catch {}

  $probes = @()
  $diag = $null
  foreach ($port in @(3000, 3200)) {
    $probe = @{ port = $port; info = $null; buildMarker = $null; diag = $null; selftest = $null }
    try {
      $info = Invoke-RestMethod -Uri "http://localhost:$port/api/system/info" `
        -Method Get -TimeoutSec 3 -ErrorAction Stop
      $probe.info = @{
        commit = $info.data.commit
        mockMode = $info.data.mockMode
        version = $info.data.version
        env = $info.data.env
      }
      # 先拿 build-marker 确认 backend 跑的是最新代码 (新 endpoint 加这个版本)
      try {
        $bm = Invoke-RestMethod -Uri "http://localhost:$port/api/system/build-marker" `
          -Method Get -TimeoutSec 3 -ErrorAction Stop
        $probe.buildMarker = $bm.data
      } catch {
        $probe.buildMarker = @{
          failed = $true
          status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
        }
      }

      # 新分层诊断: 每层独立超时 (1.5s + 2s + 3s 总 < 7s), client 10s 富余
      try {
        $diag = Invoke-RestMethod -Uri "http://localhost:$port/api/system/diag" `
          -Method Get -TimeoutSec 12 -ErrorAction Stop
        $probe.diag = $diag.data
      } catch {
        $probe.diag = @{
          failed = $true
          type = $_.Exception.GetType().Name
          status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { $null }
        }
      }

      # 真发命令: 短地址 1 调 80%, 看 backend 返回 + 灯应该亮
      $probe.lightTest = @{}
      try {
        $dp = Invoke-RestMethod -Uri "http://localhost:$port/api/system/dali-poke?short=1&value=80" `
          -Method Get -TimeoutSec 8 -ErrorAction Stop
        $probe.lightTest.short1 = @{
          success = $dp.success
          message = $dp.message
          data    = $dp.data
        }
      } catch {
        $probe.lightTest.short1 = @{
          err = $_.Exception.Message
          status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
        }
      }
      Start-Sleep -Milliseconds 800
      try {
        $dp2 = Invoke-RestMethod -Uri "http://localhost:$port/api/system/dali-poke?short=2&value=80" `
          -Method Get -TimeoutSec 8 -ErrorAction Stop
        $probe.lightTest.short2 = @{
          success = $dp2.success
          message = $dp2.message
          data    = $dp2.data
        }
      } catch {
        $probe.lightTest.short2 = @{
          err = $_.Exception.Message
          status = if ($_.Exception.Response) { [int]$_.Exception.Response.StatusCode } else { -1 }
        }
      }

      # 同时从外部网卡 IP 探一下, 看跟 localhost 是不是同一个 backend
      $probe.pokeViaExt = @{}
      foreach ($extIp in @('192.168.77.54', '192.168.50.10')) {
        $st = -1
        try {
          $r = Invoke-WebRequest -Uri "http://${extIp}:$port/api/system/dali-poke?short=99&value=0" `
            -Method Get -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop
          $st = [int]$r.StatusCode
        } catch {
          if ($_.Exception.Response) { $st = [int]$_.Exception.Response.StatusCode }
        }
        $probe.pokeViaExt[$extIp] = $st
      }
      $diag = $probe  # 第一个 info 通的端口胜出, 当作 backend 真实地址
      break
    } catch {
      $probe.info = @{ failed = $true; type = $_.Exception.GetType().Name }
    }
    $probes += $probe
  }
  if (-not $diag) {
    $diag = @{ failed = $true; probes = $probes; note = "no backend port responded on 3000/3200" }
  }
  $diag.proc = $procInfo

  $hbPayload = @{
    host = $env:COMPUTERNAME
    commit = $hbHead
    ref = 'main'
    updatedAt = (Get-Date).ToUniversalTime().ToString("o")
    version = $hbStatus
    diagnostics = $diag
  } | ConvertTo-Json -Compress -Depth 6

  # 兜底: 无论上面怎么收集, payload 超 80KB 一律降级成摘要 —— 心跳的首要职责
  # 是"活着 + 在哪个 commit", 诊断细节丢了可以再查, 心跳本身不能丢。
  if ($hbPayload.Length -gt 80KB) {
    $hbPayload = @{
      host = $env:COMPUTERNAME
      commit = $hbHead
      ref = 'main'
      updatedAt = (Get-Date).ToUniversalTime().ToString("o")
      version = $hbStatus
      diagnostics = @{ note = 'diag-truncated-oversize'; originalBytes = $hbPayload.Length }
    } | ConvertTo-Json -Compress -Depth 3
  }

  if (-not $env:SMART_CONTROL_HEARTBEAT_TOKEN_FILE) { throw 'Missing heartbeat credential file' }
  $hbToken = [IO.File]::ReadAllText($env:SMART_CONTROL_HEARTBEAT_TOKEN_FILE).Trim()
  if ($hbToken.Length -lt 32 -or $hbToken.Length -gt 512) { throw 'Invalid heartbeat credential' }
  $hbHeaders = @{ 'X-Operations-Token' = $hbToken; 'Content-Type' = 'application/json' }
  if ($env:SMART_CONTROL_HEARTBEAT_BASIC_AUTH) { $hbHeaders['Authorization'] = $env:SMART_CONTROL_HEARTBEAT_BASIC_AUTH }
  Invoke-RestMethod -Uri 'https://cnjinhu.top/control/api/system/site-heartbeat' `
    -Method Post `
    -Headers $hbHeaders `
    -Body $hbPayload -TimeoutSec 8 -MaximumRedirection 0 | Out-Null
  Log "heartbeat → cnjinhu (commit=$($hbHead.Substring(0,[Math]::Min(7,$hbHead.Length))), status=$hbStatus)" 'DarkGray'
} catch {
  Log "heartbeat 上报失败，请检查凭据、主机绑定和网络" 'Yellow'
}

if ($script:exitCode) { exit $script:exitCode }
