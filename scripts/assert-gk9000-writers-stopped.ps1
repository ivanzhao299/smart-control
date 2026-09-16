# Read-only predicate for the controlled GK9000 migration caller.
# This does NOT stop writers or establish the release isolation itself.
[CmdletBinding()]
param([string]$ProjectRoot = 'D:\smart-control', [int]$MigrationPid = 0)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
if ($env:COMPUTERNAME -ne 'GK9000') { throw 'This verifier is restricted to GK9000.' }
if ((Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\') -ne 'D:\smart-control') {
  throw 'Unexpected GK9000 project root.'
}
if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'RELEASE_HOLD') -PathType Leaf)) {
  throw 'Release hold is not present.'
}
. (Join-Path $PSScriptRoot 'gk9000-release-tasks.ps1')
# Check every known restart/backup entry, not merely the nominal backend task.
foreach ($task in @(Get-Gk9000ReleaseTasks)) {
  if ($task.State -ne 'Disabled') { throw 'A Smart Control scheduled task is not disabled.' }
}
$listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop |
  Where-Object { $_.LocalPort -in @(3200, 5173) })
if ($listeners.Count) { throw 'A production service port is still listening.' }
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop)
if ($MigrationPid) {
  $self = $processes | Where-Object { $_.ProcessId -eq $PID }
  $caller = $processes | Where-Object { $_.ProcessId -eq $MigrationPid }
  if ($self.ParentProcessId -ne $MigrationPid -or $caller.Name -ne 'node.exe' -or
      $caller.CommandLine -notmatch '(?i)D:[\\/]smart-control[\\/]backend[\\/]scripts[\\/]run-gk9000-migrations\.cjs') {
    throw 'Unexpected migration caller.'
  }
}
foreach ($process in $processes) {
  if ($process.ProcessId -eq $PID -or ($MigrationPid -and $process.ProcessId -eq $MigrationPid)) { continue }
  $command = [string]$process.CommandLine
  # Multiple PM2 daemons exist on this host. Checking only pm2.pid is unsafe.
  if ($process.Name -eq 'node.exe') {
    if (-not $command) { throw 'Cannot classify a Node process.' }
    if ($command -match '(?i)pm2|smart-control') { throw 'A service or PM2 process remains.' }
  }
  if ($process.Name -in @('powershell.exe', 'pwsh.exe', 'chrome.exe', 'msedge.exe')) {
    if (-not $command) { throw 'Cannot classify a possible player process.' }
    if ($command -match '(?i)(bgm-player|ppt-player|player-watchdog|start-players)\.ps1|smart-control-player-slot[123]') {
      throw 'A player or player launcher remains.'
    }
    if ($command -match '(?i)[\\/]smart-control[\\/]scripts[\\/](update|backup|boot-pm2|deploy-from-ci)\.ps1') {
      throw 'A maintenance writer or service launcher remains.'
    }
  }
  # Do not claim stopped while an external converter could still write media.
  # This conservative rejection never terminates unrelated applications.
  if ($process.Name -in @('ffmpeg.exe', 'WINWORD.EXE', 'POWERPNT.EXE')) {
    throw 'An external media/document process remains.'
  }
}
Write-Output 'GK9000_WRITERS_STOPPED'
