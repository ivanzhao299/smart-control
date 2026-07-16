# =====================================================================
# GK9000 player kiosk watchdog
# File: scripts/player-watchdog.ps1
#
# NOTE: keep this file ASCII-only (GK9000 PowerShell 5.1 GBK issue,
# see start-players.ps1 header).
#
# Problem this solves (2026-07-11): when backend/frontend restart (deploy,
# PM2 recovery), the kiosk Chromium windows may be left on a browser error
# page. An error page runs no JS, so PlayerPage can never heal itself and
# the slot heartbeat stays dead forever ("Kiosk offline" in the PWA).
#
# Strategy: run every 5 min as an INTERACTIVE scheduled task
# (SmartControl-PlayerWatchdog). If any slot 1-3 heartbeat is stale for
# more than $StaleMinutes while backend AND frontend are both reachable,
# relaunch all players via start-players.ps1 (it kills all slots first,
# so a full restart is the only safe granularity).
#
# Register (run once, in an interactive/desktop context):
#   powershell -ExecutionPolicy Bypass -File scripts\player-watchdog.ps1 -Register
# =====================================================================
[CmdletBinding()]
param(
  [switch]$Register,
  [int]$StaleMinutes = 3
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogFile  = Join-Path $RepoRoot 'logs\player-watchdog.log'

function Log([string]$msg) {
  $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

# ---- -Register: create the interactive scheduled task and exit ----
if ($Register) {
  $action = New-ScheduledTaskAction -Execute 'powershell.exe' `
    -Argument ('-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $PSCommandPath + '"')
  $trigger = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
    -RepetitionInterval (New-TimeSpan -Minutes 5) `
    -RepetitionDuration (New-TimeSpan -Days 3650)
  # Interactive logon type: runs in the logged-on user's desktop session, no
  # password needed, windows appear on the real monitors. An SSH-spawned GUI
  # would land in an invisible session instead.
  # NOTE: this box has NO auto-logon (checked 2026-07-16: AutoAdminLogon empty),
  # so after a reboot nothing runs until someone signs in -- same for the kiosk.
  # RunLevel Highest is required: tscon (see step 0) needs admin rights.
  $principal = New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType Interactive `
    -RunLevel Highest
  Register-ScheduledTask -TaskName 'SmartControl-PlayerWatchdog' `
    -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null
  Log 'Registered scheduled task SmartControl-PlayerWatchdog (every 5 min, interactive, elevated)'
  exit 0
}

# ---- normal watchdog run ----

# 0. Keep this session attached to the PHYSICAL CONSOLE.
#
#    Why this must run first, before any heartbeat check (2026-07-16):
#    kiosk windows only reach the LED / projector when their session is attached
#    to the physical console. Any RDP login steals the session away from the
#    console, so the physical screens fall back to the desktop wallpaper while
#    the players keep heartbeating perfectly happily inside the RDP session.
#    The staleness check below would then see "all slots healthy" and do
#    nothing -- yet the LED shows the desktop. That is exactly what happened
#    after the 2026-07-16 reboot: slot1/slot3 heartbeats were fresh, no chrome
#    was missing, and the LED still showed wallpaper.
#
#    Reattaching disconnects whoever is on RDP. On an exhibition controller the
#    physical display wins; RDP can simply reconnect (and this watchdog will
#    reattach again 5 minutes later).
function Get-ConsoleSessionId {
  try {
    Add-Type -Namespace GK -Name Wts -ErrorAction Stop -MemberDefinition @'
[DllImport("kernel32.dll")] public static extern uint WTSGetActiveConsoleSessionId();
'@
    return [int][GK.Wts]::WTSGetActiveConsoleSessionId()
  } catch { return -1 }
}

$reattached = $false
$mySession = (Get-Process -Id $PID).SessionId
$consoleSession = Get-ConsoleSessionId
if ($consoleSession -ge 0 -and $mySession -ne $consoleSession) {
  Log ('session ' + $mySession + ' is not on the console (' + $consoleSession + ') -> tscon /dest:console')
  try {
    & tscon.exe $mySession /dest:console 2>&1 | ForEach-Object { Log ('  ' + $_) }
    Start-Sleep -Seconds 3
    $reattached = $true
  } catch {
    Log ('tscon failed (needs admin?): ' + $_.Exception.Message)
  }
}

# 1. Backend must be reachable, otherwise players cannot heartbeat anyway
#    and restarting them would just load another error page.
$channels = $null
try {
  $resp = Invoke-RestMethod -Uri 'http://localhost:3200/api/playback/channels' -TimeoutSec 6
  $channels = $resp.data
} catch {
  Log ('backend unreachable, skip: ' + $_.Exception.Message)
  exit 0
}
if (-not $channels) { Log 'no channel data, skip'; exit 0 }

# 2. Frontend must serve the player page, or the relaunched kiosk would
#    land on an error page again.
try {
  Invoke-WebRequest -Uri 'http://localhost:5173/control/' -UseBasicParsing -TimeoutSec 6 | Out-Null
} catch {
  Log ('frontend unreachable, skip: ' + $_.Exception.Message)
  exit 0
}

# 3. Find stale slots (1-3). A slot is stale when it never heartbeated or
#    the last heartbeat is older than $StaleMinutes.
$now = Get-Date
$stale = @()
foreach ($c in $channels) {
  if ($c.slot -lt 1 -or $c.slot -gt 3) { continue }
  $hb = $null
  if ($c.lastHeartbeatAt) {
    try { $hb = ([datetime]::Parse($c.lastHeartbeatAt)).ToLocalTime() } catch { $hb = $null }
  }
  if ((-not $hb) -or (($now - $hb).TotalMinutes -gt $StaleMinutes)) {
    $stale += $c.slot
  }
}

# A session we just reattached ALWAYS needs a relaunch, even if every slot
# heartbeats: the windows were placed against the RDP virtual display, so their
# coordinates mean nothing on the real 3-monitor layout. Restart to re-place them.
if ($stale.Count -eq 0 -and -not $reattached) { exit 0 }

# 4. Relaunch all players (start-players.ps1 kills every slot first, so
#    per-slot restart is not possible; a short blink on healthy screens
#    is acceptable for recovery).
if ($reattached) {
  Log ('reattached to console -> restarting players to re-place windows (stale: ' + ($stale -join ',') + ')')
} else {
  Log ('stale slots: ' + ($stale -join ',') + ' -> restarting players')
}
$launcher = Join-Path $PSScriptRoot 'start-players.ps1'
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $launcher
Log 'start-players.ps1 issued'
