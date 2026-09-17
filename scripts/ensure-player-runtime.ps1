# Verify or recover the physical-console player runtime.
#
# This script never launches a browser from the caller's SSH session. It only
# starts the existing Interactive scheduled task, so Edge is created in the
# signed-in console session that owns the LED and projector outputs.
[CmdletBinding()]
param(
  [switch]$Apply,
  [ValidateRange(5, 180)][int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$root = 'D:\smart-control'
$taskName = 'SmartControl-PlayerWatchdog'

if ($env:COMPUTERNAME -ne 'GK9000') { throw 'GK9000 only.' }

$task = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
$action = @($task.Actions)
if ($action.Count -ne 1 -or $action[0].Execute -notmatch '(?i)wscript\.exe$' -or
    $action[0].Arguments -notmatch '(?i)player-watchdog\.ps1') {
  throw 'Player watchdog action is not the verified hidden interactive launcher.'
}
if ([string]$task.Principal.LogonType -ne 'Interactive' -or
    [string]$task.Principal.RunLevel -ne 'Highest') {
  throw 'Player watchdog must run as an elevated Interactive task.'
}

function Get-LedPlayerState {
  $credentialFile = & (Join-Path $root 'scripts\resolve-player-token-file.ps1')
  if (-not $?) { throw 'Player device credential path is unavailable.' }
  $deviceToken = [IO.File]::ReadAllText($credentialFile).Trim()
  try {
    if ($deviceToken -notmatch '^[a-f0-9]{64}$') { throw 'Player device credential is invalid.' }
    $response = Invoke-RestMethod -Uri 'http://127.0.0.1:3200/api/player-device/1/state' `
      -Headers @{'X-Player-Token'=$deviceToken} -TimeoutSec 6 -ErrorAction Stop
    if (-not $response.data -or $response.data.slot -ne 1) {
      throw 'Player device state response is invalid.'
    }
    return $response.data
  } finally {
    $deviceToken = $null
  }
}

if (-not $Apply) {
  if (-not $task.Settings.Enabled -or [string]$task.State -eq 'Disabled') {
    throw 'Player watchdog is disabled.'
  }
  $state = Get-LedPlayerState
  if (-not $state.alive) { throw 'LED player heartbeat is stale.' }
  Write-Output 'PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled'
  return
}

if (-not $task.Settings.Enabled -or [string]$task.State -eq 'Disabled') {
  Enable-ScheduledTask -TaskName $taskName | Out-Null
  Write-Output 'Player watchdog enabled.'
}

# Triggering the task is safe when the player is already healthy: the watchdog
# exits without relaunching. If the heartbeat is stale, it performs the recovery
# inside the physical console session and records its decision in its own log.
Start-ScheduledTask -TaskName $taskName
$deadline = (Get-Date).AddSeconds($TimeoutSeconds)
$lastError = $null
do {
  try {
    $state = Get-LedPlayerState
    if ($state.alive) {
      $freshTask = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
      if (-not $freshTask.Settings.Enabled -or [string]$freshTask.State -eq 'Disabled') {
        throw 'Player watchdog became disabled during recovery.'
      }
      Write-Output 'PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled'
      return
    }
    $lastError = 'LED player heartbeat is stale.'
  } catch {
    $lastError = $_.Exception.Message
  }
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $deadline)

throw ('LED player did not recover through the interactive watchdog: ' + $lastError)
