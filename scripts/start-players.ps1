# =====================================================================
# GK9000 three-channel player kiosk launcher
# File: scripts/start-players.ps1
#
# NOTE: keep this file ASCII-only. GK9000 PowerShell 5.1 reads BOM-less
# files as GBK; non-ASCII comment bytes can swallow the following newline
# and break param parsing (this once blanked out $BaseUrl -> URL became
# just "?slot=1" -> Edge fell back to its MSN homepage / ads).
#
# Launches Chromium/Edge windows loading PlayerPage:
#   - Main  (HDMI1 -> V2460 -> LED wall): ?slot=1   fullscreen kiosk
#   - Sub   (HDMI2 -> projector):         ?slot=2   fullscreen kiosk
#   - Audio (sound card -> EKX input):    ?slot=3   small window (sound only)
#
# Usage:
#   .\scripts\start-players.ps1            # start all three
#   .\scripts\start-players.ps1 -Stop      # kill launched player windows
#   .\scripts\start-players.ps1 -Slot 1    # start only slot=1
#   .\scripts\start-players.ps1 -Slot 3    # start only audio player
#
# Multi-monitor coords must match the real layout (Win+P / display settings).
# Default: monitor1 (HDMI1) 0,0 1920x1080 ; monitor2 (HDMI2) 1920,0 1920x1080
# =====================================================================
[CmdletBinding()]
param(
  [switch]$Stop,
  [int]$Slot = 0,
  [string]$BaseUrl = 'http://localhost:5173/control/player',
  [int]$Slot1X = 0,
  [int]$Slot1Y = 0,
  [int]$Slot2X = 1920,
  [int]$Slot2Y = 0,
  [int]$ScreenW = 1920,
  [int]$ScreenH = 1080
)

$ErrorActionPreference = 'Continue'

# Find Chromium / Edge (prefer Chrome, then Edge)
function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

# Kill existing player windows (matched by user-data-dir marker)
function Stop-Players {
  Write-Host 'Stopping existing player windows...' -ForegroundColor Yellow
  $patterns = @('player-slot1', 'player-slot2', 'player-slot3')
  foreach ($pat in $patterns) {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pat } |
      ForEach-Object {
        Write-Host ("  kill PID " + $_.ProcessId + " (" + $pat + ")") -ForegroundColor Gray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  }
}

if ($Stop) { Stop-Players; exit 0 }

$browser = Find-Browser
if (-not $browser) {
  Write-Host 'No Chrome / Edge found. Install one.' -ForegroundColor Red
  exit 1
}
Write-Host ("Browser: " + $browser) -ForegroundColor Green

# Kill old players first (avoid duplicates)
Stop-Players
Start-Sleep -Seconds 1

# Start a video slot (fullscreen kiosk on the given monitor coords).
# Edge needs --edge-kiosk-type=fullscreen to honour the --kiosk URL;
# without it Edge ignores the URL and shows its MSN homepage. Chrome
# ignores the extra flag, so it stays compatible. Window style MUST be
# Normal, not Hidden: Edge would actually hide the window otherwise.
function Start-Slot {
  param([int]$N, [int]$X, [int]$Y, [int]$W, [int]$H)
  $dataDir = "$env:LOCALAPPDATA\smart-control-player-slot$N"
  $url = "${BaseUrl}?slot=$N"
  $chromeArgs = @(
    '--kiosk', $url,
    '--edge-kiosk-type=fullscreen',
    '--edge-kiosk-reset-after-idle-timeout=0',
    "--user-data-dir=$dataDir",
    "--window-position=$X,$Y",
    "--window-size=$W,$H",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI,AutofillServerCommunication',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-pinch',
    '--disable-restore-session-state'
  )
  Write-Host ("Start slot=" + $N + " @ " + $url + " (pos " + $X + "," + $Y + ")") -ForegroundColor Cyan
  Start-Process -FilePath $browser -ArgumentList $chromeArgs -WindowStyle Normal
}

# Audio player (slot=3): app-mode window at 0,0 then COVERED by slot1's fullscreen
# kiosk, only to push sound to the sound card -> EKX input.
#
# Three hard-won rules (2026-06-23):
#  1. -WindowStyle Normal, NOT Minimized: Edge reaps a minimized --app window
#     after ~6-12s (renderer backgrounds, window closes) -> audio dies.
#  2. ON-SCREEN (0,0), NOT off-screen: a fully off-screen window gets its audio
#     throttled/paused by Chromium ("plays a few seconds then stops"). Keep it on
#     a real display at 0,0 and let slot1's fullscreen kiosk cover it (slot3
#     starts FIRST, see bottom of script) -> invisible but audio keeps playing.
#  3. --disable-features=CalculateNativeWinOcclusion + the 3 backgrounding flags
#     stop Chromium from pausing audio while the window is fully occluded.
# Clear stale Singleton lock first so a standalone (-Slot 3) restart doesn't
# bounce off a previous crash's lockfile.
function Start-AudioSlot {
  $N = 3
  $dataDir = "$env:LOCALAPPDATA\smart-control-player-slot$N"
  Remove-Item (Join-Path $dataDir 'Singleton*') -Force -ErrorAction SilentlyContinue
  $url = "${BaseUrl}?slot=$N"
  $chromeArgs = @(
    '--app=' + $url,
    "--user-data-dir=$dataDir",
    '--window-position=0,0',
    '--window-size=480,320',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-features=CalculateNativeWinOcclusion',
    '--disable-restore-session-state'
  )
  Write-Host ("Start slot=3 audio @ " + $url + " (off-screen Normal window, sound card -> EKX)") -ForegroundColor Magenta
  Start-Process -FilePath $browser -ArgumentList $chromeArgs -WindowStyle Normal
}

# slot3 (audio) starts FIRST at 0,0; slot1's fullscreen kiosk (also 0,0) then
# covers it -> slot3 invisible but audio keeps playing (on-screen + occlusion
# flags). slot2 goes to the projector (1920,0) and never touches slot3.
if ($Slot -eq 0 -or $Slot -eq 3) {
  Start-AudioSlot
  Start-Sleep -Milliseconds 800
}
if ($Slot -eq 0 -or $Slot -eq 1) {
  Start-Slot -N 1 -X $Slot1X -Y $Slot1Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 2) {
  Start-Sleep -Milliseconds 500
  Start-Slot -N 2 -X $Slot2X -Y $Slot2Y -W $ScreenW -H $ScreenH
}

Write-Host ''
Write-Host 'Player kiosk started.' -ForegroundColor Green
Write-Host 'Stop with: .\scripts\start-players.ps1 -Stop' -ForegroundColor Gray
