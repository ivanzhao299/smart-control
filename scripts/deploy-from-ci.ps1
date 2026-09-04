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

function Invoke-DetachedResurrect {
  # Bring pm2 (daemon + both apps) back WITHOUT tying the daemon to this SSH
  # session. An in-session `pm2 resurrect` respawns the daemon INSIDE the SSH
  # session; when the session exits the daemon dies and takes both services
  # with it - CI green, production dead (the 2026-07-25 "SSH session trap",
  # and the most likely shape of the 2026-07-26 afternoon outage: services
  # died hours after a green deploy with no new commits in between).
  # WMI Win32_Process.Create detaches the process into session 0. WMI does not
  # pass the caller environment, so PM2_HOME is injected into the command line
  # (same proven trick as boot-pm2.ps1).
  $pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
  if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }
  $pm2Home = 'C:\Users\user\.pm2'
  $env:PM2_HOME = $pm2Home

  # Kill any daemon currently answering on this PM2_HOME first. If one is alive
  # - typically the EMPTY one that a just-failed in-session `pm2 restart`
  # spawned inside this SSH session - the detached resurrect below would reach
  # it over the shared named pipe and load the apps into IT, reintroducing the
  # session trap. Every caller of this function runs with services already
  # down, so killing the daemon loses nothing.
  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = 'Continue'
    & $pm2 kill 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
  } catch {
    Write-DeployLog "pm2 kill failed (continuing): $($_.Exception.Message)"
  } finally {
    $ErrorActionPreference = $previousPreference
  }

  # Clear surviving orphan port holders: resurrect on top of one crash-loops
  # on EADDRINUSE (the 2026-07-15 421-restart incident). The apps a killed
  # daemon owned can survive it as orphans still holding 3200/5173.
  foreach ($port in @(3200, 5173)) {
    $owners = @(
      Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty OwningProcess -Unique
    )
    foreach ($opid in $owners) {
      if ($opid -and $opid -gt 0) {
        Write-DeployLog ("  port {0} held by pid {1} -> stop" -f $port, $opid)
        Stop-Process -Id $opid -Force -ErrorAction SilentlyContinue
      }
    }
  }
  Start-Sleep -Seconds 2

  # Chain resurrect -> start ecosystem -> save inside the ONE detached process.
  # `pm2 resurrect` alone cannot recover two known-real states (2026-07-26 #207
  # failed exactly here): a dump.pm2 that was overwritten empty (nothing to
  # restore), and apps left permanently 'errored' after max_restarts was
  # exhausted (resurrect does not touch existing app entries). `pm2 start
  # <ecosystem>` covers both - it creates missing apps and restarts existing
  # ones from the declarative config. The trailing save then repairs the dump
  # while the apps are actually up. Plain & (not &&) between the pm2 steps so
  # a failing resurrect does not stop the ecosystem start.
  # NO space before '&&' after the set value (2026-07-27): cmd includes every
  # character between '=' and '&&' in the value, so a space there gives
  # PM2_HOME a trailing space. pm2 builds its rpc/pub named-pipe names
  # verbatim from PM2_HOME (pipe names skip Win32 path normalization, the
  # space survives), so that daemon lives on pipe names no normal client
  # ever computes -> every later pm2 call misses it and hatches yet another
  # daemon. That was the source of the 128-idle-daemon herd found 2026-07-27.
  $eco = Join-Path $projectRoot 'deploy\ecosystem.config.js'
  $cmd = "cmd /c `"set PM2_HOME=$pm2Home&& $pm2 resurrect & $pm2 start $eco --env production & $pm2 save`""
  Write-DeployLog "WMI detached recover: $cmd"
  $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\user', $null)
  Write-DeployLog ("  WMI ProcessId={0} ReturnValue={1}" -f $r.ProcessId, $r.ReturnValue)
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
  # 2026-07-26: resurrect DETACHED, not in-session. The old in-session
  # `pm2 resurrect` here rebuilt everything inside this SSH session - all green
  # until the session exited, then the daemon and both services died with it.
  # Also: no `pm2 save` in this branch. If the detached resurrect has not come
  # up yet, an in-session save spawns a fresh EMPTY daemon and overwrites
  # dump.pm2 with an empty list, destroying the only recovery point.
  Write-DeployLog 'pm2 daemon had no such process -> detached resurrect from last dump'
  Invoke-DetachedResurrect
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
      # Tolerate the on-box auto-update watcher racing ahead of CI (2026-07-27):
      # between this run's deploy step and its verify step the watcher may have
      # already fast-forwarded GK9000 PAST the requested commit. The requested
      # commit IS live (plus newer ones) - that is success, not failure. Strict
      # equality here produced false-red runs (#214/#227 pattern) while
      # production was perfectly healthy. Behind/diverged states remain fatal.
      & git merge-base --is-ancestor $Commit $previousCommit
      if ($LASTEXITCODE -eq 0) {
        Write-DeployLog "GK9000 is at $previousCommit which already contains $Commit (watcher deployed ahead) - verifying the newer state."
      } else {
        throw "GK9000 is at $previousCommit, expected $Commit."
      }
    }
  } else {
    $trackedChanges = @(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree.' }
    if ($trackedChanges.Count -gt 0) {
      throw "Tracked files are modified on GK9000: $($trackedChanges -join '; ')"
    }

    # git fetch 竞态容忍 (2026-07-30 #52ec765 现场): watcher 的 fetch 可能与本脚本
    # 同时更新 origin/main 的 ref, git 报 "cannot lock ref ... but expected ..." —
    # ref 其实已被对方更到位, 等一拍重试即可, 不该让整次部署红掉。
    $fetched = $false
    for ($fi = 0; $fi -lt 3; $fi++) {
      try {
        Invoke-Native 'git' @('fetch', '--prune', 'origin', 'main')
        $fetched = $true
        break
      } catch {
        Write-DeployLog "git fetch attempt $($fi + 1) failed (watcher ref-lock race?), retry in 3s"
        Start-Sleep -Seconds 3
      }
    }
    if (-not $fetched) { throw 'git fetch failed after 3 attempts.' }
    Invoke-Native 'git' @('cat-file', '-e', "${Commit}^{commit}")
    & git merge-base --is-ancestor $Commit origin/main
    if ($LASTEXITCODE -ne 0) { throw 'Requested commit is not part of origin/main.' }

    & git merge-base --is-ancestor $Commit $previousCommit
    if ($LASTEXITCODE -eq 0) {
      Write-DeployLog "Requested commit is already deployed or superseded by $previousCommit."

      # The on-box watcher can fast-forward Git before its frontend build finishes.
      # In that race CI used to short-circuit here and verify the old dist against
      # itself. Validate the entry bundle on disk before accepting "already deployed".
      $frontendIndex = Join-Path $projectRoot 'frontend\dist\index.html'
      $frontendBundleMissing = $false
      if (-not (Test-Path $frontendIndex)) {
        $frontendBundleMissing = $true
      } else {
        $indexText = Get-Content -Path $frontendIndex -Raw
        $entryMatch = [regex]::Match($indexText, '/control/assets/([^"'']+\.js)')
        if (-not $entryMatch.Success) {
          $frontendBundleMissing = $true
        } else {
          $entryFile = Join-Path (Join-Path $projectRoot 'frontend\dist\assets') $entryMatch.Groups[1].Value
          $frontendBundleMissing = -not (Test-Path $entryFile)
        }
      }
      if ($frontendBundleMissing) {
        Write-DeployLog 'Frontend entry bundle is missing after Git fast-forward; rebuilding frontend before verification.'
        Push-Location (Join-Path $projectRoot 'frontend')
        try {
          Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
          # Build beside the damaged dist. Some old asset files on GK9000 can
          # have broken ACLs and make Vite's initial dist cleanup fail with
          # EPERM. A side build is complete before it touches production.
          $repairDir = Join-Path $projectRoot 'frontend\dist-repair'
          Remove-Item -Path $repairDir -Recurse -Force -ErrorAction SilentlyContinue
          Invoke-Native 'pnpm.cmd' @('exec', 'vite', 'build', '--outDir', 'dist-repair')
          $productionDist = Join-Path $projectRoot 'frontend\dist'
          Get-ChildItem -Path $repairDir -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($repairDir.Length).TrimStart('\')
            $target = Join-Path $productionDist $relative
            $targetExists = $true
            try { $targetExists = Test-Path $target } catch { $targetExists = $true }
            if (-not $targetExists) {
              New-Item -ItemType Directory -Force -Path (Split-Path $target -Parent) | Out-Null
              Copy-Item -Path $_.FullName -Destination $target
            }
          }
          # Publish fixed-name entry files last, after every hashed dependency exists.
          foreach ($rootFile in @('index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest')) {
            $source = Join-Path $repairDir $rootFile
            if (Test-Path $source) { Copy-Item -Path $source -Destination (Join-Path $productionDist $rootFile) -Force }
          }
          Remove-Item -Path $repairDir -Recurse -Force -ErrorAction SilentlyContinue
        } finally {
          Pop-Location
        }
      }
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
        # Keep 7 (was 14): each snapshot is a full SQLite copy (~39MB), so 14 was ~550MB.
        # 7 gives a one-week rollback window - enough to catch "config got changed by
        # mistake" and revert; nobody ever reaches for anything older.
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

      # Run DB migrations after build, before restart. With DB_SYNCHRONIZE=false the
      # schema only changes through migrations, so this is where new ones get applied.
      # run-migrations.js is a no-op when nothing is pending, backs up the DB before it
      # touches anything, and exits non-zero on failure -> the catch below rolls back.
      Push-Location (Join-Path $projectRoot 'backend')
      try {
        Write-DeployLog 'Running DB migrations (run-migrations.js).'
        & node scripts/run-migrations.js 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
        if ($LASTEXITCODE -ne 0) { throw "Database migration failed (exit $LASTEXITCODE)." }
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
  if (-not $healthy) {
    # Self-heal (2026-07-26): on the already-deployed short-circuit (and in
    # VerifyOnly mode) nothing above has restarted anything, so a dead pm2
    # daemon just failed here with no recovery attempt - and this restricted
    # CI path is the ONLY remote hand we have on the box. Try one detached
    # resurrect, then run the health loop again before giving up.
    Write-DeployLog 'Health checks failed - attempting detached pm2 resurrect, then re-check.'
    try {
      Invoke-DetachedResurrect
    } catch {
      Write-DeployLog "Detached resurrect failed: $($_.Exception.Message)"
    }
    for ($attempt = 1; $attempt -le 30; $attempt++) {
      if ((Test-BackendHealth) -and (Test-FrontendHealth)) {
        Write-DeployLog "Health checks passed after resurrect on attempt $attempt."
        $healthy = $true
        break
      }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $healthy) { throw 'GK9000 backend or frontend did not become healthy (even after detached pm2 resurrect).' }

  # Authoritative deploy verification. The health loop above only proves "something is
  # answering on 3200/5173" - it cannot prove the NEW code is live: an orphaned old
  # process still holding the port answers 200 just the same (that was the root cause of
  # the 2026-07-16 "deployed but never went live" incident). verify-deploy.js is the
  # single source of truth: pm2 online / port-holder PID == pm2 PID / process start time
  # newer than dist mtime / health status==ok / restart count stable over 3s.
  # update.ps1 has always run it; this CI path was missing it, so we add it here.
  # On failure we fall through to the rollback block below.
  #
  # KEEP THIS FILE ASCII-ONLY. Non-ASCII comments get mangled under the GBK console
  # codepage and can swallow the FOLLOWING line's newline - that is exactly how the
  # assignment below once got absorbed into a comment, leaving $verifier null and
  # failing three otherwise-successful deploys (2026-07-20).
  $verifier = Join-Path $projectRoot 'scripts\verify-deploy.js'
  if (Test-Path $verifier) {
    Write-DeployLog 'Running verify-deploy.js (authoritative deploy verification).'
    & node $verifier 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
    if ($LASTEXITCODE -ne 0) {
      # 2026-07-25: flappy verifies root cause - when the pm2 daemon happens to be
      # down, update.ps1's in-session `pm2 start` respawns the daemon INSIDE this
      # SSH session; SSH exits -> daemon dies -> services die -> verify red, while
      # the on-box watcher revives everything a minute later (result green, CI red).
      # Self-heal here: restart backend through WMI (detached from this session,
      # same trick as boot-pm2.ps1), wait, then verify once more.
      Write-DeployLog 'verify failed - detached pm2 restart via WMI, then re-verify.'
      # Literal path, not $env:APPDATA - the double-hop non-interactive SSH
      # session leaves APPDATA/USERPROFILE empty (see Restart-Services note),
      # which made this Join-Path throw and silently skipped the self-heal.
      $pm2cmd = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
      if (-not (Test-Path $pm2cmd)) { $pm2cmd = 'pm2' }
      try {
        # No space before '&&' - see Invoke-DetachedResurrect for why (trailing
        # space would poison PM2_HOME and hatch an orphan daemon).
        ([wmiclass]'\\.\root\cimv2:Win32_Process').Create("cmd /c `"set PM2_HOME=C:\Users\user\.pm2&& $pm2cmd restart smart-control-backend --update-env`"", 'C:\Users\user', $null) | Out-Null
      } catch {
        Write-DeployLog "WMI detached restart failed: $($_.Exception.Message)"
      }
      # 2026-07-30 (deploys d7142f9 + e1615c2 false reds): the WMI-detached restart
      # can lag 5-30s before it actually kills the process, so a plain "poll until
      # healthy" is satisfied by the OLD process and re-verify then meets the
      # restart mid-flight (waiting-restart state + counter bump read as a crash
      # loop). Two phases: first wait for health to DIP (proof the restart fired),
      # then wait for recovery. If it never dips within 90s assume the restart was
      # lost or instant and proceed - verify will tell the truth either way.
      $sawDown = $false
      for ($i = 1; $i -le 18; $i++) {
        Start-Sleep -Seconds 5
        if (-not (Test-BackendHealth)) { $sawDown = $true; break }
      }
      if (-not $sawDown) {
        Write-DeployLog 'WARN: backend never dipped within 90s - detached restart lost or instant; proceeding.'
      }
      $reHealthy = $false
      for ($i = 1; $i -le 30; $i++) {
        if (Test-BackendHealth) { $reHealthy = $true; break }
        Start-Sleep -Seconds 5
      }
      if ($reHealthy) {
        # Settle so pm2 restart counters and port ownership are stable before verify.
        Start-Sleep -Seconds 5
      } else {
        Write-DeployLog 'WARN: backend health not back within 150s - running verify anyway for the full report.'
      }
      & node $verifier 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
      if ($LASTEXITCODE -ne 0) {
        throw "verify-deploy.js reported failure after detached-restart retry (exit $LASTEXITCODE)."
      }
    }
    Write-DeployLog 'verify-deploy.js passed.'
  } else {
    Write-DeployLog 'WARN: scripts\verify-deploy.js not found - authoritative verification skipped.'
  }

  # Prune stale rollback snapshots - keep only the current one.
  # The directory name carries the commit ($ProgramData\Anksen\smart-control-rollback-<sha>)
  # and the block above only removes the SAME-named one, so every new commit left behind a
  # full copy of backend+frontend dist that was never reclaimed - it grew with every deploy.
  # By this point the deploy has passed verify-deploy, so older rollback points are worthless:
  # to go back a version just redeploy that commit (everything is in git).
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
