# Controlled activation after a verified offline migration. Default: read-only.
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-f0-9]{40}$')][string]$Commit,
  [Parameter(Mandatory=$true)][string]$TaskSnapshot,
  [Parameter(Mandatory=$true)][string]$MigrationReceipt,
  [switch]$Apply
)
$ErrorActionPreference = 'Stop'
$root = 'D:\smart-control'
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }
$names = @('SmartControl-AutoUpdate','SmartControl-DailyBackup','SmartControl-PlayerWatchdog','SmartControlBackend','SmartControlFrontend')
$snapshot = [IO.File]::ReadAllText($TaskSnapshot) | ConvertFrom-Json
$receipt = [IO.File]::ReadAllText($MigrationReceipt) | ConvertFrom-Json
if ($snapshot.Version -ne 1 -or @($snapshot.Tasks).Count -ne $names.Count -or
    @($snapshot.Tasks.Name | Sort-Object -Unique).Count -ne $names.Count) { throw 'Invalid task snapshot.' }
foreach ($task in $snapshot.Tasks) {
  if ($task.Name -notin $names -or $task.Enabled -isnot [bool]) { throw 'Unexpected task restoration entry.' }
}
if ($receipt.version -ne 1 -or $receipt.kind -ne 'gk9000-migration-complete' -or
    $receipt.candidateRevision -ne $Commit -or $receipt.productionActivated -ne $false) { throw 'Invalid migration handoff.' }
$head = & git -C $root rev-parse HEAD
if ($LASTEXITCODE -ne 0 -or $head -ne $Commit) { throw 'Checkout does not match candidate.' }
$main = & git -C $root rev-parse origin/main
if ($LASTEXITCODE -ne 0 -or $main -ne $Commit) { throw 'Candidate is not the fetched main revision.' }
$dirty = & git -C $root status --porcelain --untracked-files=no
if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Tracked checkout changes prevent activation.' }
& (Join-Path $PSScriptRoot 'assert-gk9000-writers-stopped.ps1') -ProjectRoot $root | Out-Null
if (-not $?) { throw 'Release is not stopped.' }
& node (Join-Path $root 'backend\scripts\verify-gk9000-migration-receipt.cjs') $MigrationReceipt $Commit $root
if ($LASTEXITCODE -ne 0) { throw 'Recovery bundle verification failed.' }
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
  foreach ($task in $snapshot.Tasks) {
    if ($task.Enabled) { Enable-ScheduledTask -TaskName $task.Name | Out-Null }
    else { Disable-ScheduledTask -TaskName $task.Name | Out-Null }
  }
  # This is an Interactive task; never run start-players.ps1 in SSH Session 0.
  if (@($snapshot.Tasks | Where-Object { $_.Name -eq 'SmartControl-PlayerWatchdog' -and $_.Enabled }).Count) {
    Start-ScheduledTask -TaskName 'SmartControl-PlayerWatchdog'
  }
  Write-Output 'Candidate services verified and original task enablement restored. Physical player and user acceptance are still required.'
} catch {
  # No code/data rollback: preserve private uploads and stop known services.
  if (-not (Test-Path -LiteralPath $hold)) { [IO.File]::WriteAllText($hold, 'Activation failed; retain isolation.') }
  foreach ($name in $names) {
    Disable-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue | Out-Null
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
  }
  & $pm2 stop smart-control-backend smart-control-frontend 2>&1 | Out-Null
  throw 'Activation failed; RELEASE_HOLD restored. Verify actual port owners are stopped; no old-code rollback was attempted.'
}
