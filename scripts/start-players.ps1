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
  # kill the background-music daemon (windowless powershell running bgm-player.ps1)
  Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -and $_.CommandLine -match 'bgm-player' } |
    ForEach-Object {
      Write-Host ("  kill PID " + $_.ProcessId + " (bgm-player)") -ForegroundColor Gray
      Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
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

# Audio player (slot=3): NOT Edge anymore. Background music is played by a
# windowless WPF MediaPlayer daemon (bgm-player.ps1). Edge audio windows can't
# survive on this box: slot1/2 topmost fullscreen kiosks cover both monitors, and
# Chromium pauses audio for any minimized / off-screen / fully-occluded window
# (tried all three on 2026-06-23, all failed). A windowless MediaPlayer has no
# such constraint -> audio just plays. See bgm-player.ps1 header for the full saga.
function Start-AudioSlot {
  $script = Join-Path $PSScriptRoot 'bgm-player.ps1'
  Write-Host ("Start background-music daemon (windowless MediaPlayer): " + $script) -ForegroundColor Magenta
  Start-Process -FilePath 'powershell.exe' `
    -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $script) `
    -WindowStyle Hidden
}

# slot1/2 kiosks first (fullscreen LED + projector), then slot3 audio LAST so its
# small visible window stays ON TOP in the LED bottom-right corner (it must stay
# visible or Chromium pauses its audio).
if ($Slot -eq 0 -or $Slot -eq 1) {
  Start-Slot -N 1 -X $Slot1X -Y $Slot1Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 2) {
  Start-Sleep -Milliseconds 500
  Start-Slot -N 2 -X $Slot2X -Y $Slot2Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 3) {
  Start-Sleep -Milliseconds 500
  Start-AudioSlot
}

Write-Host ''
Write-Host 'Player kiosk started.' -ForegroundColor Green
Write-Host 'Stop with: .\scripts\start-players.ps1 -Stop' -ForegroundColor Gray
