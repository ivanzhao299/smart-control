# Controlled activation after a verified offline migration. Default: read-only.
[CmdletBinding(DefaultParameterSetName='Migrated')]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [Parameter(Mandatory=$true)][string]$TaskSnapshot,
  [Parameter(Mandatory=$true,ParameterSetName='Migrated')][string]$MigrationReceipt,
  [Parameter(Mandatory=$true,ParameterSetName='Aborted')][switch]$AbortBeforeMigration,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = 'D:\smart-control'
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
. (Join-Path $PSScriptRoot 'gk9000-release-tasks.ps1')
$snapshot = [IO.File]::ReadAllText($TaskSnapshot) | ConvertFrom-Json
if ($snapshot.Version -ne 1 -or $snapshot.SourceRevision -notmatch '^[a-f0-9]{40}$') {
  throw 'Invalid task snapshot.'
}
Assert-Gk9000TaskSnapshot $snapshot
if ($AbortBeforeMigration) {
  if ($snapshot.SourceRevision -ne $Commit) { throw 'Abort revision does not match the pre-migration snapshot.' }
} else {
  $receipt = [IO.File]::ReadAllText($MigrationReceipt) | ConvertFrom-Json
  if ($receipt.version -ne 1 -or $receipt.kind -ne 'gk9000-migration-complete' -or
      $receipt.candidateRevision -ne $Commit -or $receipt.productionActivated -ne $false) { throw 'Invalid migration handoff.' }
}
$head = (& git -C $root rev-parse HEAD).Trim()
if ($LASTEXITCODE -ne 0 -or $head -ne $Commit) { throw 'Checkout does not match activation revision.' }
if (-not $AbortBeforeMigration) {
  $main = (& git -C $root rev-parse origin/main).Trim()
  if ($LASTEXITCODE -ne 0 -or $main -ne $Commit) { throw 'Candidate is not the fetched main revision.' }
}
$dirty = & git -C $root status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked checkout changes prevent activation.' }
& (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
if (-not $?) { throw 'Release is not stopped.' }
if (-not $AbortBeforeMigration) {
  & node (Join-Path $root 'backend\scripts\verify-gk9000-migration-receipt.cjs') $MigrationReceipt $Commit $root
  if ($LASTEXITCODE -ne 0) { throw 'Recovery bundle verification failed.' }
}
if (-not $Apply) { Write-Output 'Activation preflight passed. No files, tasks or services changed.'; return }
# Rebuild the exact tracked candidate while services and scheduled tasks are stopped.
foreach ($component in @('backend','frontend')) {
  Push-Location (Join-Path $root $component)
  try {
    & pnpm.cmd install --frozen-lockfile
    if ($LASTEXITCODE -ne 0) { throw 'Locked dependency install failed.' }
    & pnpm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Candidate build failed.' }
  } finally { Pop-Location }
}
& (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
if (-not $?) { throw 'Release isolation changed during build.' }
$head = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -ne $Commit) { throw 'Candidate changed during build.' }
$hold = Join-Path $root 'RELEASE_HOLD'
$retainedHold = Join-Path $root ('logs\activated-hold-' + [Guid]::NewGuid().ToString('N'))
$pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
if (-not (Test-Path -LiteralPath $pm2)) { throw 'Expected PM2 executable missing.' }
$env:PM2_HOME = 'C:\Users\user\.pm2'
$env:PATH = (Split-Path -Parent $pm2) + ';' + $env:PATH
Move-Item -LiteralPath $hold -Destination $retainedHold
# --- Stage 1 (fatal): backend + frontend core activation. If the detached
#     start, runtime verification or pm2 save fails, fail closed: restore the
#     release hold, disable release tasks and stop the services. No code/data
#     rollback is attempted. ---
try {
  # Start from the candidate ecosystem, not potentially stale dump.pm2 entries.
  $cmd = 'cmd /c "set PM2_HOME=C:\Users\user\.pm2&& C:\Users\user\AppData\Roaming\npm\pm2.cmd start D:\smart-control\deploy\ecosystem.config.js --env production --only smart-control-backend,smart-control-frontend"'
  $started = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\user', $null)
  if ($started.ReturnValue -ne 0) { throw 'Detached service startup failed.' }
  Start-Sleep -Seconds 20
  & node (Join-Path $root 'scripts\verify-deploy.js')
  if ($LASTEXITCODE -ne 0) { throw 'Runtime service verification failed.' }
  & $pm2 save
  if ($LASTEXITCODE -ne 0) { throw 'Unable to retain new PM2 configuration.' }
} catch {
  if (-not (Test-Path -LiteralPath $hold)) { [IO.File]::WriteAllText($hold, 'Activation failed; retain isolation.') }
  foreach ($task in @(Get-Gk9000ReleaseTasks)) {
    Disable-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue | Out-Null
    Stop-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue
  }
  & $pm2 stop smart-control-backend smart-control-frontend 2>&1 | Out-Null
  throw 'Activation failed; RELEASE_HOLD restored. Verify actual port owners are stopped; no old-code rollback was attempted.'
}

# --- Stage 2 (NON-FATAL): physical-console player follow-up. The core
#     backend/frontend are verified and live from this point on. Kiosk profile
#     provisioning drives a browser over CDP and can time out in the CI SSH
#     Session 0 (no interactive desktop) or while a player browser is still
#     closing. On 2026-10-13 exactly this rolled back healthy services and
#     caused a full outage. A failure here must never stop the core services:
#     it is recorded as a marker + warning and the PlayerWatchdog still keeps
#     the player browsers alive; an operator re-runs provisioning from the
#     signed-in interactive console. ---
$kioskMarker = Join-Path $root 'logs\KIOSK_PROVISION_NEEDED'
if (Test-Path -LiteralPath $kioskMarker) { Remove-Item -LiteralPath $kioskMarker -Force -ErrorAction SilentlyContinue }
try {
  # Configure the existing dedicated profiles headlessly while the Interactive
  # watchdog is still disabled. No credential is placed in a launch argument.
  & node (Join-Path $root 'backend\scripts\provision-kiosk-profiles.cjs')
  if ($LASTEXITCODE -ne 0) { throw "Dedicated kiosk profile configuration failed (exit $LASTEXITCODE)." }
} catch {
  $kioskDetail = 'provision-kiosk-profiles failed at ' + (Get-Date).ToString('s') + "`r`n" + $_.Exception.Message + "`r`nCore services are live. Re-run backend\scripts\provision-kiosk-profiles.cjs from the signed-in interactive console; PlayerWatchdog keeps the player browsers alive."
  [IO.File]::WriteAllText($kioskMarker, $kioskDetail)
  Write-Output ('KIOSK_PROVISION_WARNING: ' + $_.Exception.Message + ' -- core services remain live; marker logs\KIOSK_PROVISION_NEEDED')
}

# Restore scheduled tasks (always). A disabled player watchdog is an operational
# fault, not a desired release state, so it is always re-enabled even when kiosk
# provisioning failed. Each task is best-effort and never fatal to the core.
foreach ($task in $snapshot.Tasks) {
  try {
    if ($task.Name -eq 'SmartControl-PlayerWatchdog' -or $task.Enabled) {
      Enable-ScheduledTask -TaskName $task.Name | Out-Null
    } else {
      Disable-ScheduledTask -TaskName $task.Name | Out-Null
    }
  } catch {
    Write-Output ('Task restore warning for ' + $task.Name + ': ' + $_.Exception.Message)
  }
}
# This is an Interactive task; never run start-players.ps1 in SSH Session 0.
try {
  Start-ScheduledTask -TaskName 'SmartControl-PlayerWatchdog'
} catch {
  Write-Output ('Player watchdog trigger warning: ' + $_.Exception.Message)
}

# Make the activation result explicit so a non-zero native exit code left over
# from a warned-off kiosk provisioning run cannot be misread as activation
# failure by the caller's $LASTEXITCODE check.
$global:LASTEXITCODE = 0
if (Test-Path -LiteralPath $kioskMarker) {
  Write-Output 'CORE_ACTIVATION_OK with KIOSK_PROVISION_WARNING: backend/frontend verified and retained; kiosk profile provisioning needs an interactive-console follow-up.'
} else {
  Write-Output 'Candidate services verified; task enablement restored and the interactive player watchdog triggered.'
}
