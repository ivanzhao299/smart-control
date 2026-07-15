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
        & $backupScript -Keep 14 2>&1 | ForEach-Object { Write-DeployLog "  $_" }
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

      foreach ($taskName in @('SmartControlBackend', 'SmartControlFrontend')) {
        Write-DeployLog "Restarting scheduled task: $taskName"
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      }
      Start-Sleep -Seconds 2
      foreach ($taskName in @('SmartControlBackend', 'SmartControlFrontend')) {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
      }
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
      foreach ($taskName in @('SmartControlBackend', 'SmartControlFrontend')) {
        Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue
      }
      Start-Sleep -Seconds 2
      foreach ($taskName in @('SmartControlBackend', 'SmartControlFrontend')) {
        Start-ScheduledTask -TaskName $taskName -ErrorAction Stop
      }
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
