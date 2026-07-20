[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[0-9a-f]{40}$')]
  [string]$Commit,

  [string]$ProjectRoot,

  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
$projectRoot = if ($ProjectRoot) {
  (Resolve-Path $ProjectRoot).Path
} else {
  (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
}
$logsDir = Join-Path $projectRoot 'logs'
$lockPath = Join-Path $env:ProgramData 'Anksen\smart-control-deploy.lock'
$startedAt = (Get-Date).ToUniversalTime()
$previousCommit = $null
$result = 'FAILED'
$errorMessage = $null
$lockStream = $null
$worktreeUpdated = $false
$rollbackRoot = Join-Path $env:ProgramData ("Anksen\smart-control-rollback-{0}" -f $Commit)

New-Item -ItemType Directory -Force -Path $logsDir | Out-Null
New-Item -ItemType Directory -Force -Path (Split-Path $lockPath -Parent) | Out-Null
$logPath = Join-Path $logsDir ("ci-deploy-{0}.log" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-DeployLog([string]$Message) {
  $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Add-Content -Path $logPath -Value $line -Encoding UTF8
  Write-Output $line
}

function Invoke-Native([string]$FilePath, [string[]]$Arguments) {
  Write-DeployLog ("> {0} {1}" -f $FilePath, ($Arguments -join ' '))
  $previousPreference = $ErrorActionPreference
  $exitCode = 0
  try {
    $ErrorActionPreference = 'Continue'
    & $FilePath @Arguments 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
    $exitCode = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previousPreference
  }
  if ($exitCode -ne 0) {
    throw "Command failed with exit code ${exitCode}: $FilePath"
  }
}

function Restart-Services {
  # Restart through pm2, not scheduled tasks. Since 2026-07-16 pm2 is the single
  # owner of both services (SmartControlBackend boot-resurrects pm2,
  # SmartControlFrontend disabled -- see boot-pm2.ps1). The old Start-ScheduledTask
  # restart cannot work here: the frontend task is disabled (throws) and the
  # backend task is only a boot shim, it does not restart the running node process.
  #
  # IMPORTANT: this file MUST stay ASCII-only. PowerShell 5.1 on Chinese Windows
  # reads .ps1 as the GBK codepage; a non-ASCII comment in a UTF-8 (no BOM) file
  # eats the following newline, merging the next line into the comment. That is
  # what silently commented out the "$pm2 = ..." assignment and made every restart
  # fail with "Test-Path: Path is null" (2026-07-16, chased for several rounds).
  #
  # Use literal absolute paths -- do NOT read $env:APPDATA/$env:USERPROFILE: the
  # double-hop non-interactive SSH session (GitHub -> Aliyun -> WireGuard -> GK9000)
  # leaves both empty. Set PM2_HOME literally too, else pm2 may not find the
  # existing daemon and spawns an orphan. GK9000 is a fixed single host (user 'user').
  $pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
  if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }
  $env:PM2_HOME = 'C:\Users\user\.pm2'
  Write-DeployLog "pm2 = $pm2 ; PM2_HOME = $env:PM2_HOME"

  # Happy path: the daemon is alive and already owns both apps.
  # Only the restart may fall through to recovery -- do NOT put `pm2 save` in this
  # try, or a hiccup in save would send us into the port-killing branch below.
  $needsRecovery = $false
  try {
    Invoke-Native $pm2 @('restart', 'smart-control-backend', 'smart-control-frontend', '--update-env')
  } catch {
    Write-DeployLog "pm2 restart failed: $($_.Exception.Message)"
    $needsRecovery = $true
  }
  if (-not $needsRecovery) {
    Invoke-Native $pm2 @('save')
    return
  }

  # Recovery (2026-07-17): 'Process or Namespace smart-control-backend not found'.
  # The old daemon was gone, so pm2 just spawned a FRESH EMPTY one and restart had
  # nothing to act on. This is not rare: the daemon dies with the SSH session that
  # spawned it (that is exactly why boot-pm2.ps1 detaches it through WMI). Before
  # this block the deploy died here AND the rollback died here too -- rollback calls
  # this same function -- leaving "requires operator attention" and no way in.
  #
  # The node processes the dead daemon used to own usually SURVIVE as orphans still
  # holding 3200/5173 (verify-deploy.js calls this out as "port holder PID != pm2
  # PID"). So a plain `pm2 resurrect` here would start a SECOND copy that crash-loops
  # on EADDRINUSE. Clear the port holders first, then resurrect from the last
  # `pm2 save` dump -- the worktree is already at the target commit, so resurrect
  # brings up the NEW code.
  Write-DeployLog 'pm2 daemon had no such process -> clearing port holders, then resurrect'
  foreach ($port in @(3200, 5173)) {
    $owners = @(
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($opid in $owners) {
      if ($opid -and $opid -gt 0) {
        Write-DeployLog ("  port {0} held by orphan pid {1} -> stop" -f $port, $opid)
        Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Start-Sleep -Seconds 2
  Invoke-Native $pm2 @('resurrect')
  Invoke-Native $pm2 @('save')
  # Caller still runs the port + health checks below; if resurrect did not bring
  # them back the deploy fails and rolls back exactly as before.
}

function Test-BackendHealth {
  try {
    $response = Invoke-RestMethod 'http://127.0.0.1:3200/api/system/health' -TimeoutSec 5 -ErrorAction Stop
    return $response.data.status -eq 'ok'
  } catch {
    return $false
  }
}

function Test-FrontendHealth {
  try {
    $response = Invoke-WebRequest 'http://127.0.0.1:5173/' -UseBasicParsing -TimeoutSec 5 -ErrorAction Stop
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

try {
  try {
    $lockStream = [System.IO.File]::Open(
      $lockPath,
      [System.IO.FileMode]::OpenOrCreate,
      [System.IO.FileAccess]::ReadWrite,
      [System.IO.FileShare]::None
    )
  } catch {
    throw 'Another GK9000 deployment is already running.'
  }

  Set-Location $projectRoot
  $previousCommit = (git rev-parse HEAD).Trim()
  Write-DeployLog "Requested deployment: $previousCommit -> $Commit"

  if ($VerifyOnly) {
    if ($previousCommit -ne $Commit) {
      throw "GK9000 is at $previousCommit, expected $Commit."
    }
  } else {
    $trackedChanges = @(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree.' }
    if ($trackedChanges.Count -gt 0) {
      throw "Tracked files are modified on GK9000: $($trackedChanges -join '; ')"
    }

    Invoke-Native 'git' @('fetch', '--prune', 'origin', 'main')
    Invoke-Native 'git' @('cat-file', '-e', "${Commit}^{commit}")
    & git merge-base --is-ancestor $Commit origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Requested commit is not part of origin/main.' }

    & git merge-base --is-ancestor $Commit $previousCommit
    if ($LASTEXITCODE -eq 0) {
      Write-DeployLog "Requested commit is already deployed or superseded by $previousCommit."
    } else {
      & git merge-base --is-ancestor $previousCommit $Commit
      if ($LASTEXITCODE -ne 0) { throw 'GK9000 and the requested commit have diverged.' }

      Remove-Item -Path $rollbackRoot -Recurse -Force -ErrorAction SilentlyContinue
      New-Item -ItemType Directory -Force -Path $rollbackRoot | Out-Null
      foreach ($relativeDist in @('backend\dist', 'frontend\dist')) {
        $sourceDist = Join-Path $projectRoot $relativeDist
        if (Test-Path $sourceDist) {
          $backupDist = Join-Path $rollbackRoot $relativeDist
          New-Item -ItemType Directory -Force -Path (Split-Path $backupDist -Parent) | Out-Null
          Copy-Item -Path $sourceDist -Destination $backupDist -Recurse -Force
        }
      }

      Invoke-Native 'git' @('merge', '--ff-only', $Commit)
      $worktreeUpdated = $true

      $backupScript = Join-Path $projectRoot 'scripts\backup.ps1'
      if (Test-Path $backupScript) {
        Write-DeployLog 'Creating the existing production backup before build.'
        # 保留 7 份 (原 14): 每份是一整个 SQLite 快照 (~39MB), 14 份就是 ~550MB。
        # 7 份 = 一周回溯窗口, 足够发现"配置被误改/数据不对"再回退; 更早的没人会用。
        & $backupScript -Keep 7 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
      }

      Push-Location (Join-Path $projectRoot 'backend')
      try {
        Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
        Invoke-Native 'pnpm.cmd' @('run', 'build')
      } finally {
        Pop-Location
      }

      Push-Location (Join-Path $projectRoot 'frontend')
      try {
        Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
        Invoke-Native 'pnpm.cmd' @('run', 'typecheck')
        Invoke-Native 'pnpm.cmd' @('run', 'build')
      } finally {
        Pop-Location
      }

      Write-DeployLog 'Restarting services through pm2.'
      Restart-Services
    }
  }

  $healthy = $false
  for ($attempt = 1; $attempt -le 30; $attempt++) {
    if ((Test-BackendHealth) -and (Test-FrontendHealth)) {
      Write-DeployLog "Health checks passed on attempt $attempt."
      $healthy = $true
      break
    }
    Start-Sleep -Seconds 2
  }
  if (-not $healthy) { throw 'GK9000 backend or frontend did not become healthy.' }

  # 权威部署验证 — 上面的 health 循环只能证明"有 3200/5173 在应答", 证明不了跑的是新代码:
  # 孤儿旧进程占着端口时 health 一样返回 200 (2026-07-16 踩过, "部署后没跑通"的根因).
  # verify-deploy.js 才是唯一判据: pm2 online / 端口持有者 PID == pm2 记录的 PID /
  # 进程启动时间 > dist mtime / health status==ok / 重启计数 3s 内不增长.
  # update.ps1 早就走它了, CI 这条路径之前漏了, 这里补齐 —— 失败则走下面已有的回滚。
  # 用 $PSScriptRoot(本脚本所在的 scripts 目录), **不要用 $projectRoot** ——
  # 那个变量只在"需要更新代码"的分支里赋值; 走"已经是目标 commit"的快捷路径时它是空的,
  # Join-Path 会返回空 → Test-Path 报"参数是空值"→ 把一次本来成功的部署判成失败并回滚。
  # 2026-07-20 踩过一次。update.ps1 里一直用的就是 $PSScriptRoot。
  $verifier = Join-Path $PSScriptRoot 'verify-deploy.js'
  if (Test-Path $verifier) {
    Write-DeployLog 'Running verify-deploy.js (authoritative deploy verification).'
    & node $verifier 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
    if ($LASTEXITCODE -ne 0) {
      throw "verify-deploy.js reported failure (exit $LASTEXITCODE)."
    }
    Write-DeployLog 'verify-deploy.js passed.'
  } else {
    Write-DeployLog 'WARN: scripts\verify-deploy.js not found - authoritative verification skipped.'
  }

  # 清理历史回滚备份 —— 只留当前这一份。
  # 原来的目录名带 commit ($ProgramData\Anksen\smart-control-rollback-<sha>), 而上面
  # 只 Remove 了"同名"那个, 所以**每换一个 commit 就留下一整份前后端 dist 副本, 永不回收**,
  # 部署越多占得越多。部署到这里已经通过 verify-deploy 验证, 旧回滚点没有价值了 ——
  # 真要退版本, 直接用目标 commit 重新部署即可 (代码都在 git 上)。
  $rollbackParent = Join-Path $env:ProgramData 'Anksen'
  if (Test-Path $rollbackParent) {
    $stale = Get-ChildItem -Path $rollbackParent -Directory -Filter 'smart-control-rollback-*' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $rollbackRoot }
    foreach ($d in $stale) {
      Write-DeployLog "Pruning stale rollback snapshot: $($d.Name)"
      Remove-Item -Path $d.FullName -Recurse -Force -ErrorAction SilentlyContinue
    }
    if ($stale) { Write-DeployLog "Pruned $($stale.Count) stale rollback snapshot(s)." }
  }

  $deployedCommit = (git rev-parse HEAD).Trim()
  $result = 'PASS'
  Write-DeployLog "Deployment complete: $deployedCommit"
} catch {
  $errorMessage = $_.Exception.Message
  Write-DeployLog "Deployment failed: $errorMessage"
  if ($worktreeUpdated -and $previousCommit) {
    Write-DeployLog "Rolling the worktree and build artifacts back to $previousCommit."
    try {
      Invoke-Native 'git' @('reset', '--hard', $previousCommit)
      foreach ($relativeDist in @('backend\dist', 'frontend\dist')) {
        $targetDist = Join-Path $projectRoot $relativeDist
        $backupDist = Join-Path $rollbackRoot $relativeDist
        if (Test-Path $backupDist) {
          Remove-Item -Path $targetDist -Recurse -Force -ErrorAction SilentlyContinue
          Copy-Item -Path $backupDist -Destination $targetDist -Recurse -Force
        }
      }
      Restart-Services
      Write-DeployLog 'Rollback completed.'
    } catch {
      Write-DeployLog "Rollback failed and requires operator attention: $($_.Exception.Message)"
    }
  }
  throw
} finally {
  $currentCommit = $null
  try { $currentCommit = (git -C $projectRoot rev-parse HEAD 2>$null).Trim() } catch { }
  $audit = [ordered]@{
    host = $env:COMPUTERNAME
    requestedCommit = $Commit
    previousCommit = $previousCommit
    currentCommit = $currentCommit
    verifyOnly = [bool]$VerifyOnly
    result = $result
    error = $errorMessage
    startedAt = $startedAt.ToString('o')
    completedAt = (Get-Date).ToUniversalTime().ToString('o')
    logPath = $logPath
  }
  $auditPath = Join-Path $logsDir ("ci-deploy-{0}.json" -f (Get-Date -Format 'yyyyMMdd-HHmmss'))
  $audit | ConvertTo-Json | Set-Content -Path $auditPath -Encoding UTF8
  if ($lockStream) { $lockStream.Dispose() }
}
