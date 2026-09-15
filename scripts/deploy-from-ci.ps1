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
& (Join-Path $projectRoot 'scripts\assert-release-not-held.ps1') -ReleaseProjectRoot $projectRoot
$lockPath = Join-Path $env:ProgramData 'Anksen\smart-control-deploy.lock'
$startedAt = (Get-Date).ToUniversalTime()
$previousCommit = $null
$result = 'FAILED'
$errorMessage = $null
$lockStream = $null
$worktreeUpdated = $false
$migrationAttempted = $false
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

# --- Minimal deployment scope detection (2026-09-14) ---
# Classify files changed between two commits. Static assets and single-tier
# code changes deploy with minimal blast radius; anything touching deps,
# config, migrations, deploy scripts, or both tiers falls back to full deploy.
# ASCII-only on purpose (GBK console on Chinese Windows).
function Get-DeployScope([string]$FromCommit, [string]$ToCommit) {
  $files = @(git diff --name-only $FromCommit $ToCommit)
  $s = [ordered]@{
    docs = $false
    parkOpsStatic = $false
    frontendPublic = $false
    frontendCode = $false
    backendCode = $false
    highRisk = $false
    files = $files
  }
  $highRiskPattern = '(package\.json|pnpm-lock\.yaml|\.env|ecosystem\.config|migrations?/|deploy/|scripts/(deploy|backup|update|boot|ensure|run-migrations|assert-release))'
  foreach ($f in $files) {
    if ($f -match $highRiskPattern) { $s.highRisk = $true }
    elseif ($f -match '^frontend/public/park-ops/') { $s.parkOpsStatic = $true }
    elseif ($f -match '^frontend/public/') { $s.frontendPublic = $true }
    elseif ($f -match '^frontend/(src/|index\.html|vite\.config|tsconfig)') { $s.frontendCode = $true }
    elseif ($f -match '^backend/src/') { $s.backendCode = $true }
    elseif ($f -match '^docs/' -or $f -match '(^|/)(README|CHANGELOG|HANDOVER|MEMORY)\.md$') { $s.docs = $true }
    else { $s.highRisk = $true }
  }
  return $s
}

function Deploy-StaticAssets($scope, $projectRoot) {
  $publicDir = Join-Path $projectRoot 'frontend\public'
  $distDir = Join-Path $projectRoot 'frontend\dist'
  foreach ($f in $scope.files) {
    if ($f -match '^frontend/public/') {
      $relative = $f.Substring('frontend/public/'.Length)
      $src = Join-Path $publicDir ($relative -replace '/', '\')
      $dst = Join-Path $distDir ($relative -replace '/', '\')
      $dstDir = Split-Path $dst -Parent
      if (-not (Test-Path $dstDir)) { New-Item -ItemType Directory -Force -Path $dstDir | Out-Null }
      if (Test-Path $src) {
        Copy-Item -Path $src -Destination $dst -Force
        Write-DeployLog "  static: $relative"
      }
    }
  }
}

function Deploy-FrontendOnly($projectRoot) {
  # Side-build to dist-repair then swap into production dist. vite preview
  # reads from disk on every request (ecosystem.config.js), so no restart
  # is needed - zero-downtime frontend update.
  Push-Location (Join-Path $projectRoot 'frontend')
  try {
    Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
    $repairDir = Join-Path $projectRoot 'frontend\dist-repair'
    Remove-Item -Path $repairDir -Recurse -Force -ErrorAction SilentlyContinue
    Invoke-Native 'pnpm.cmd' @('exec', 'vite', 'build', '--outDir', 'dist-repair')
    $productionDist = Join-Path $projectRoot 'frontend\dist'
    Copy-Item -Path (Join-Path $repairDir '*') -Destination $productionDist -Recurse -Force
    Remove-Item -Path $repairDir -Recurse -Force -ErrorAction SilentlyContinue
  } finally {
    Pop-Location
  }
}

function Deploy-BackendOnly($projectRoot) {
  Push-Location (Join-Path $projectRoot 'backend')
  try {
    Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
    Invoke-Native 'pnpm.cmd' @('run', 'build')
  } finally {
    Pop-Location
  }
  $pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
  if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }
  $env:PM2_HOME = 'C:\Users\user\.pm2'
  Invoke-Native $pm2 @('restart', 'smart-control-backend', '--update-env')
  Invoke-Native $pm2 @('save')
}

try {
  # Wait for the on-box watcher (update.ps1 now shares this SAME lock) instead
  # of failing red the instant it is busy. A watcher build can take a couple of
  # minutes, so poll up to ~150s; only give up if the lock never frees. ASCII.
  $lockStream = $null
  for ($lockTry = 0; $lockTry -lt 30; $lockTry++) {
    try {
      $lockStream = [System.IO.File]::Open(
        $lockPath,
        [System.IO.FileMode]::OpenOrCreate,
        [System.IO.FileAccess]::ReadWrite,
        [System.IO.FileShare]::None
      )
      break
    } catch {
      $lockStream = $null
      Start-Sleep -Seconds 5
    }
  }
  if (-not $lockStream) {
    throw 'Another GK9000 deployment is still running after waiting 150s.'
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
    $rawChanges = @(git status --porcelain --untracked-files=no)
    if ($LASTEXITCODE -ne 0) { throw 'Unable to inspect the Git worktree.' }
    # Exempt runtime files that ARE declared in .gitignore but were historically
    # tracked by mistake (SQLite *.db-shm/*.db-wal, logs): they always change while
    # the service runs, so blocking on them has no protective value and only turns
    # every deploy red (root cause of #522/#523 on 2026-09-13). --no-index matches
    # ignore rules without consulting the index (plain check-ignore never matches a
    # tracked path). Real changes (source/lock/config) are NOT in .gitignore and are
    # still blocked hard; the gate is not loosened for them. ASCII-only on purpose.
    $trackedChanges = @()
    $ignoredRuntime = @()
    foreach ($line in $rawChanges) {
      if ($null -eq $line -or $line.Length -le 3) { continue }
      $path = $line.Substring(3).Trim('"')
      if ($path -match ' -> ') { $path = ($path -split ' -> ')[-1] }
      $null = & git check-ignore --no-index --quiet -- $path 2>$null
      if ($LASTEXITCODE -eq 0) { $ignoredRuntime += $line } else { $trackedChanges += $line }
    }
    if ($ignoredRuntime.Count -gt 0) {
      Write-DeployLog "Ignoring runtime files already declared in .gitignore: $($ignoredRuntime -join '; ')"
    }
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
        $entryMatch = [regex]::Match($indexText, '/control/(assets(?:-[\w.-]+)?)/([^"'']+\.js)')
        if (-not $entryMatch.Success) {
          $frontendBundleMissing = $true
        } else {
          $entryFile = Join-Path (Join-Path $projectRoot "frontend\dist\$($entryMatch.Groups[1].Value)") $entryMatch.Groups[2].Value
          $frontendBundleMissing = -not (Test-Path $entryFile)
        }
      }
      $parkOpsIndex = Join-Path $projectRoot 'frontend\dist\park-ops\index.html'
      $parkOpsAerial = Join-Path $projectRoot 'frontend\dist\park-ops\park-aerial.jpg'
      $parkOpsRelief = Join-Path $projectRoot 'frontend\dist\park-ops\park-aerial-relief.glb'
      $parkOps3dViewer = Join-Path $projectRoot 'frontend\dist\park-ops\park-ops-3d.js'
      if (-not (Test-Path $parkOpsIndex) -or -not (Test-Path $parkOpsAerial) -or
          -not (Test-Path $parkOpsRelief) -or -not (Test-Path $parkOps3dViewer)) {
        $frontendBundleMissing = $true
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
          $repairAssetsName = 'assets-' + $Commit.Substring(0, 8)
          Remove-Item -Path $repairDir -Recurse -Force -ErrorAction SilentlyContinue
          Invoke-Native 'pnpm.cmd' @('exec', 'vite', 'build', '--outDir', 'dist-repair', '--assetsDir', $repairAssetsName)
          $productionDist = Join-Path $projectRoot 'frontend\dist'
          # Publish to a versioned directory, bypassing the legacy assets ACL.
          $productionAssets = Join-Path $productionDist $repairAssetsName
          Move-Item -Path (Join-Path $repairDir $repairAssetsName) -Destination $productionAssets
          # Publish fixed-name entry files last, after every hashed dependency exists.
          foreach ($rootFile in @('index.html', 'sw.js', 'registerSW.js', 'manifest.webmanifest')) {
            $source = Join-Path $repairDir $rootFile
            if (Test-Path $source) { Copy-Item -Path $source -Destination (Join-Path $productionDist $rootFile) -Force }
          }
          $repairParkOps = Join-Path $repairDir 'park-ops'
          $productionParkOps = Join-Path $productionDist 'park-ops'
          if (Test-Path $repairParkOps) {
            New-Item -ItemType Directory -Force -Path $productionParkOps | Out-Null
            Copy-Item -Path (Join-Path $repairParkOps '*') -Destination $productionParkOps -Recurse -Force
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

      # === Runtime-data protection (root-cause fix 2026-09-15: KPI and AI
      # count-line/ROI were lost because runtime JSON lived INSIDE the git tree
      # and got deleted/reset by deploy). Resolve the out-of-tree DATA_DIR exactly
      # like deploy/ecosystem.config.js does. ASCII-only on purpose. ===
      $runtimeDataDir = $env:DATA_DIR
      if ([string]::IsNullOrWhiteSpace($runtimeDataDir)) {
        if (Test-Path 'D:\') { $runtimeDataDir = 'D:\smart-control-runtime\data' }
        else { $runtimeDataDir = Join-Path $projectRoot '.runtime\data' }
      }
      New-Item -ItemType Directory -Force -Path $runtimeDataDir | Out-Null
      $legacyDataDir = Join-Path $projectRoot 'backend\data'

      # BEFORE merge: rescue on-box runtime data out of the tree. Copy EVERY runtime
      # *.json under backend\data (except *.example.json templates), not a fixed name
      # list, so future runtime files are migrated too. Copy only, never delete
      # source, never overwrite a newer existing target. video-binding.json used to be
      # tracked and is removed from the repo by this change, so ff-merge would drop
      # the in-tree copy - the out-of-tree DATA_DIR copy is what survives.
      if (Test-Path $legacyDataDir) {
        Get-ChildItem -Path $legacyDataDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -notlike '*.example.json' } |
          ForEach-Object {
            $safePath = Join-Path $runtimeDataDir $_.Name
            if (-not (Test-Path $safePath)) {
              Copy-Item -Path $_.FullName -Destination $safePath -Force
              Write-DeployLog "Protected runtime $($_.Name) copied to DATA_DIR before merge ($runtimeDataDir)."
            }
          }
      }

      # A modified tracked legacy JSON would block a later commit that removes it
      # from the repository. Once the same file is confirmed in DATA_DIR, restore
      # only the in-tree working copy from HEAD so merge can proceed. DATA_DIR is
      # never overwritten or removed here.
      $trackedRuntimeFiles = @(
        git status --porcelain |
          Where-Object { ($_ -notmatch '^\?\?') -and $_.Length -gt 3 } |
          ForEach-Object { $_.Substring(3).Trim('"') } |
          Where-Object {
            $candidate = $_.Replace('/', '\')
            ($candidate -like 'backend\data\*.json') -and ($candidate -notlike '*.example.json')
          }
      )
      foreach ($relativeFile in $trackedRuntimeFiles) {
        $safePath = Join-Path $runtimeDataDir (Split-Path $relativeFile -Leaf)
        if (Test-Path $safePath) {
          Invoke-Native 'git' @('restore', '--worktree', '--', $relativeFile)
          Write-DeployLog "Restored tracked legacy runtime copy after DATA_DIR protection: $relativeFile"
        } else {
          throw "Refusing to restore tracked runtime file without DATA_DIR copy: $relativeFile"
        }
      }

      # Protected on-box paths that must NEVER be removed as untracked files.
      # Keep logs too: they are operational evidence and never a merge conflict target.
      function Test-ProtectedRuntime([string]$rel) {
        if ([string]::IsNullOrWhiteSpace($rel)) { return $false }
        $r = $rel.Replace('/', '\')
        return ($r -like 'backend\data\*') -or ($r -like '.runtime\*') -or `
               ($r -like 'database\*') -or ($r -like 'backups\*') -or `
               ($r -like 'logs\*') -or `
               ($r -match '\.(db|db-wal|db-shm|sqlite|bak)$')
      }

      # Only paths present in the target tree can block a fast-forward merge.
      # Preserve every unrelated untracked file. Move true conflicts into this
      # commit's rollback snapshot so the operation is reversible and auditable.
      $untrackedFiles = @(git status --porcelain --untracked-files=all | Where-Object { $_ -match '^\?\?' } | ForEach-Object { $_.Substring(3).Trim('"') })
      $protectedKept = @()
      $conflicts = @()
      foreach ($u in $untrackedFiles) {
        $gitPath = $u.Replace('\', '/')
        $previousPreference = $ErrorActionPreference
        try {
          $ErrorActionPreference = 'Continue'
          & git cat-file -e ("{0}:{1}" -f $Commit, $gitPath) 2>$null
          $existsInTarget = ($LASTEXITCODE -eq 0)
        } finally {
          $ErrorActionPreference = $previousPreference
        }
        if (-not $existsInTarget) { continue }
        if (Test-ProtectedRuntime $u) { $protectedKept += $u } else { $conflicts += $u }
      }
      if ($protectedKept.Count -gt 0) {
        throw "Target commit conflicts with protected runtime/db files: $($protectedKept -join ', ')"
      }
      if ($conflicts.Count -gt 0) {
        $quarantineRoot = Join-Path $rollbackRoot 'untracked-conflicts'
        Write-DeployLog "Quarantining $($conflicts.Count) untracked merge conflict(s): $($conflicts -join ', ')"
        foreach ($relativeFile in $conflicts) {
          $fullPath = Join-Path $projectRoot $relativeFile
          $quarantinePath = Join-Path $quarantineRoot $relativeFile
          New-Item -ItemType Directory -Force -Path (Split-Path $quarantinePath -Parent) | Out-Null
          Move-Item -Path $fullPath -Destination $quarantinePath -Force
        }
      }

      Invoke-Native 'git' @('merge', '--ff-only', $Commit)

      # After merge: best-effort migrate any runtime *.json still missing from
      # DATA_DIR (whole legacy dir, skip templates; copy only, never overwrite).
      if (Test-Path $legacyDataDir) {
        Get-ChildItem -Path $legacyDataDir -Filter '*.json' -File -ErrorAction SilentlyContinue |
          Where-Object { $_.Name -notlike '*.example.json' } |
          ForEach-Object {
            $safePath = Join-Path $runtimeDataDir $_.Name
            if (-not (Test-Path $safePath)) {
              Copy-Item -Path $_.FullName -Destination $safePath -Force
              Write-DeployLog "Post-merge migrated runtime $($_.Name) -> DATA_DIR."
            }
          }
      }
      $worktreeUpdated = $true

      $backupScript = Join-Path $projectRoot 'scripts\backup.ps1'
      if (Test-Path $backupScript) {
        Write-DeployLog 'Creating the existing production backup before build.'
        # Snapshot evidence is retained; database-only backup is not a media rollback bundle.
        & $backupScript 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
      } else {
        throw 'Required production backup script is missing.'
      }

      # --- Minimal deployment scope detection (2026-09-14) ---
      $scope = Get-DeployScope $previousCommit $Commit
      $staticOnly = (-not $scope.frontendCode -and -not $scope.backendCode -and -not $scope.highRisk)
      $frontendOnly = ($scope.frontendCode -and -not $scope.backendCode -and -not $scope.highRisk)
      $backendOnly = ($scope.backendCode -and -not $scope.frontendCode -and -not $scope.highRisk)
      Write-DeployLog ("Deploy scope: staticOnly={0} frontendOnly={1} backendOnly={2} highRisk={3} files=[{4}]" -f $staticOnly, $frontendOnly, $backendOnly, $scope.highRisk, ($scope.files -join ','))

      if ($staticOnly) {
        Write-DeployLog 'MINIMAL deploy: static assets only - copying to dist, skipping build and service restart.'
        Deploy-StaticAssets $scope $projectRoot
      } elseif ($frontendOnly) {
        Write-DeployLog 'MINIMAL deploy: frontend code only - side-building frontend, skipping backend and restart (vite preview reads disk, zero-downtime).'
        Deploy-FrontendOnly $projectRoot
      } elseif ($backendOnly) {
        Write-DeployLog 'MINIMAL deploy: backend code only - building and restarting backend, skipping frontend build.'
        Deploy-BackendOnly $projectRoot
        # A backend-only commit may ALSO carry frontend/public static assets (park-ops demo,
        # icons, etc.). Deploy-BackendOnly skips the frontend build, so copy those static
        # files straight into dist afterwards - vite preview reads disk on every request,
        # so this is zero-downtime. Without this sync the static half of a mixed
        # (backend + public) commit was silently dropped: git updated public/ but dist/ stayed
        # stale and preview kept serving the old asset (root cause of "frontend change not
        # live after deploy" on 2026-09-15).
        if ($scope.parkOpsStatic -or $scope.frontendPublic) {
          Write-DeployLog 'Mixed commit also carries frontend/public assets - syncing them into dist (no frontend build).'
          Deploy-StaticAssets $scope $projectRoot
        }
      } else {
        Write-DeployLog 'FULL deploy: multi-tier or high-risk changes - running complete deployment.'

        Push-Location (Join-Path $projectRoot 'backend')
        try {
          Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
          Invoke-Native 'pnpm.cmd' @('run', 'build')
        } finally {
          Pop-Location
        }

        # Stop the frontend BEFORE Vite empties dist: a still-running pm2 static
        # server (plus Defender real-time scan) can hold dist/park-ops/index.html
        # and make Vite prepareOutDir fail with EPERM/ENOTEMPTY (Deploy #531,
        # 2026-09-14). Backend stays up throughout; Restart-Services below brings
        # the frontend back after the build. Literal paths, ASCII-only.
        $pm2Fe = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
        if (-not (Test-Path $pm2Fe)) { $pm2Fe = 'pm2' }
        $env:PM2_HOME = 'C:\Users\user\.pm2'
        & $pm2Fe stop smart-control-frontend 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
        Start-Sleep -Seconds 2

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
        # run-migrations.js is a no-op when nothing is pending. Pending migrations
        # now require a continuous writer-fence controller and paired DB/media
        # recovery rehearsal. This legacy CLI path fails closed until that controller
        # is wired and verified on the target host. Once attempted, code-only rollback is forbidden: old
        # public media routes must never run against a possibly multiuser database.
        Push-Location (Join-Path $projectRoot 'backend')
        try {
          Write-DeployLog 'Running DB migrations (run-migrations.js).'
          $migrationAttempted = $true
          & node scripts/run-migrations.js 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
          if ($LASTEXITCODE -ne 0) { throw "Database migration failed (exit $LASTEXITCODE)." }
        } finally {
          Pop-Location
        }

        Write-DeployLog 'Restarting services through pm2.'
        Restart-Services
      }
    }
  }

  # Always reconcile migrations. The on-box watcher may fast-forward Git before CI
  # arrives, and an already-deployed source SHA does not prove its DB migration ran.
  Push-Location (Join-Path $projectRoot 'backend')
  try {
    # Guard: backend dist must exist before running migrations. The on-box watcher
    # can fast-forward Git and leave dist stale/cleaned after a previous failed deploy.
    $backendDataSource = Join-Path $projectRoot 'backend\dist\data-source.js'
    if (-not (Test-Path $backendDataSource)) {
      Write-DeployLog 'Backend dist/data-source.js missing; rebuilding backend before migrations.'
      Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
      Invoke-Native 'pnpm.cmd' @('run', 'build')
    }
    Write-DeployLog 'Reconciling DB migrations (run-migrations.js).'
    $migrationAttempted = $true
    & node scripts/run-migrations.js 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "Database migration failed (exit $LASTEXITCODE)." }
  } finally {
    Pop-Location
  }

  # Common path on purpose: the on-box watcher can fast-forward Git before CI
  # arrives, so required host tooling must not live only in the "new commit"
  # branch above.

  # CI-only deployment policy (2026-09-15): the legacy SmartControl-AutoUpdate
  # scheduled task + auto-update-watcher raced CI and repeatedly reset on-box
  # runtime config. Idempotently keep it disabled and stop any watcher process
  # on every deploy, regardless of deploy scope. ASCII-only.
  try {
    $auTask = Get-ScheduledTask -TaskName 'SmartControl-AutoUpdate' -ErrorAction SilentlyContinue
    if ($auTask -and $auTask.State -ne 'Disabled') {
      Disable-ScheduledTask -TaskName 'SmartControl-AutoUpdate' | Out-Null
      Write-DeployLog 'SmartControl-AutoUpdate disabled (deployment is CI-only).'
    }
    $auProcs = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -match 'auto-update-watcher' })
    foreach ($auP in $auProcs) {
      Stop-Process -Id $auP.ProcessId -Force -ErrorAction SilentlyContinue
      Write-DeployLog ("Stopped AutoUpdate watcher pid {0}." -f $auP.ProcessId)
    }
  } catch {
    Write-DeployLog "AutoUpdate disable step skipped: $($_.Exception.Message)"
  }

  $mediaToolsScript = Join-Path $projectRoot 'scripts\ensure-media-tools.ps1'
  if (Test-Path $mediaToolsScript) {
    Write-DeployLog 'Ensuring verified FFmpeg media compatibility tools are installed.'
    & $mediaToolsScript 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
    if ($LASTEXITCODE -ne 0) { throw "FFmpeg media tools installation failed (exit $LASTEXITCODE)." }
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
    throw 'Required deployment verifier scripts\verify-deploy.js is missing.'
  }

  # Keep three verified snapshots. This bounds disk use while preserving two prior
  # recovery points in case the newest release has a delayed operational failure.
  $rollbackParent = Join-Path $env:ProgramData 'Anksen'
  if (Test-Path $rollbackParent) {
    $stale = Get-ChildItem -Path $rollbackParent -Directory -Filter 'smart-control-rollback-*' -ErrorAction SilentlyContinue |
      Where-Object { $_.FullName -ne $rollbackRoot } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -Skip 2
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
  if ($migrationAttempted) {
    Write-DeployLog 'MIGRATION_RECOVERY_REQUIRED: preserving current code, database, media and rollback artifacts. Code-only rollback is forbidden.'
    try {
      # Fail closed after a possibly committed ownership migration. Recovery must
      # archive post-migration data and restore a matched database/media/code set.
      Invoke-Native 'pm2.cmd' @('stop', 'smart-control-backend', 'smart-control-frontend')
    } catch {
      Write-DeployLog 'CRITICAL: service stop failed; isolate external ingress immediately before recovery.'
    }
  } elseif ($worktreeUpdated -and $previousCommit) {
    Write-DeployLog "Rolling the worktree and build artifacts back to $previousCommit."
    try {
      # Stop BOTH services first so 'git reset --hard' can replace tracked files:
      # the running backend locks database/*.db-shm/*.db-wal (historically tracked)
      # and made reset fail with "unable to unlink ... Invalid argument", leaving a
      # half-deployed tree with an emptied dist (Deploy #531, 2026-09-14). ASCII.
      $pm2Rb = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
      if (-not (Test-Path $pm2Rb)) { $pm2Rb = 'pm2' }
      $env:PM2_HOME = 'C:\Users\user\.pm2'
      & $pm2Rb stop smart-control-backend smart-control-frontend 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
      Start-Sleep -Seconds 2
      Invoke-Native 'git' @('reset', '--hard', $previousCommit)
      # Reset restores the historically-tracked SQLite runtime files from the old
      # commit. They are regenerable shared-memory/WAL files: MOVE (never delete)
      # them aside so the backend rebuilds them cleanly against the untouched main
      # smart-control.db (which is not tracked and therefore never reset).
      $dbDir = Join-Path $projectRoot 'database'
      foreach ($runtimeDb in @('smart-control.db-shm', 'smart-control.db-wal')) {
        $runtimePath = Join-Path $dbDir $runtimeDb
        if (Test-Path $runtimePath) {
          $movedPath = Join-Path $rollbackRoot ($runtimeDb + '.rollback-moved')
          Move-Item -Path $runtimePath -Destination $movedPath -Force -ErrorAction SilentlyContinue
          Write-DeployLog "Moved runtime $runtimeDb to the rollback point (moved, not deleted)."
        }
      }
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
    migrationAttempted = $migrationAttempted
    recoveryRequired = ($migrationAttempted -and $result -ne 'PASS')
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
