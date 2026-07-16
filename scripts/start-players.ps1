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

# Start a video slot (fullscreen on the given monitor coords).
#
# 2026-07-16: switched from --kiosk to --app. Microsoft documents that
# --kiosk does NOT support multiple monitors: it force-fullscreens onto the
# PRIMARY display and silently ignores --window-position. Symptom on site:
# slot1 (LED) and slot2 (projector) both landed at (0,0) stacked on top of
# each other, so the LED showed the projector's page. Official workaround is
# --app=URL + --window-position + --start-fullscreen, which gives the same
# chrome-less fullscreen UX but honours per-monitor coords.
#   https://learn.microsoft.com/en-us/answers/questions/1162281/
#
# Window style MUST be Normal, not Hidden: Edge would actually hide it.
function Start-Slot {
  param([int]$N, [int]$X, [int]$Y, [int]$W, [int]$H)
  $dataDir = "$env:LOCALAPPDATA\smart-control-player-slot$N"
  $url = "${BaseUrl}?slot=$N"
  $chromeArgs = @(
    "--app=$url",
    "--window-position=$X,$Y",
    "--window-size=$W,$H",
    '--start-fullscreen',
    "--user-data-dir=$dataDir",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI,AutofillServerCommunication',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-pinch',
    '--disable-restore-session-state',
    # PlayerPage needs microphone permission so enumerateDevices() exposes device
    # LABELS -- that is how it finds the HDMI endpoint for setSinkId (slot1/2
    # audio -> splitter -> matrix IN4 -> OUT5 -> LED amp). Without labels it
    # silently falls back to the Windows default device (USB card -> IN1), which
    # OUT5 does not listen to, and the LED goes silent again.
    #
    # 2026-07-16: tried replacing this with the AudioCaptureAllowedUrls policy to
    # avoid the infobar -- it did NOT work on this box (workgroup / unmanaged, so
    # Edge ignored the HKLM policy). Measured: HDMI endpoint peak dropped to
    # 0.0000 and audio went back to the USB card. So the flag stays.
    #
    # --use-fake-UI-for-media-stream only auto-accepts the permission prompt; it
    # still uses the REAL devices. (--use-fake-DEVICE-for-media-stream would
    # substitute fake ones -- never add that.)
    '--use-fake-ui-for-media-stream',
    # Suppresses the yellow "you are using an unsupported command-line flag"
    # infobar that the flag above triggers -- it was painting across the top of
    # the LED wall. This is what ChromeDriver/Selenium have used for years.
    '--test-type'
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
  # Launch via WMI Win32_Process.Create so the daemon is DETACHED. A powershell
  # child started with Start-Process gets killed when the launching SSH session
  # ends (Edge re-parents itself so it survives, but powershell does not -> the
  # bgm daemon died a few seconds after every SSH deploy). WMI Create parents it
  # to the WMI service, so it keeps running after SSH / parent exits, and the
  # same call works when launched from the Startup folder at boot. Windowless
  # MCI playback (bgm-player.ps1) -> no window, no occlusion, no throttling.
  $cmd = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $script + '"'
  Write-Host ("Start background-music daemon (detached, windowless MCI): " + $script) -ForegroundColor Magenta
  ([WMIClass]'Win32_Process').Create($cmd) | Out-Null
}

# How many real monitors does this session see? A slot whose coords fall outside
# every monitor would otherwise get dumped on the primary display and cover the
# slot that belongs there (2026-07-16: projector unplugged -> slot2 landed on the
# LED and hid slot1, site saw the projector's standby page on the LED wall).
Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue
function Test-CoordsOnScreen {
  param([int]$X, [int]$Y)
  try {
    foreach ($s in [System.Windows.Forms.Screen]::AllScreens) {
      if ($X -ge $s.Bounds.X -and $X -lt ($s.Bounds.X + $s.Bounds.Width) -and
          $Y -ge $s.Bounds.Y -and $Y -lt ($s.Bounds.Y + $s.Bounds.Height)) { return $true }
    }
  } catch { return $true }   # can't tell (e.g. session 0) -> don't block
  return $false
}

# slot1/2 fullscreen (LED + projector), then slot3 audio LAST so its small visible
# window stays ON TOP in the LED bottom-right corner (it must stay visible or
# Chromium pauses its audio).
if ($Slot -eq 0 -or $Slot -eq 1) {
  Start-Slot -N 1 -X $Slot1X -Y $Slot1Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 2) {
  # -Slot 2 (explicit) always starts: operator asked for it on purpose.
  # -Slot 0 (start all) skips it when no monitor lives at those coords.
  if ($Slot -eq 2 -or (Test-CoordsOnScreen -X $Slot2X -Y $Slot2Y)) {
    Start-Sleep -Milliseconds 500
    Start-Slot -N 2 -X $Slot2X -Y $Slot2Y -W $ScreenW -H $ScreenH
  } else {
    Write-Host ("SKIP slot=2: no monitor at " + $Slot2X + "," + $Slot2Y + " (projector not connected?).") -ForegroundColor Yellow
    Write-Host "      Starting it would cover slot1 on the LED. Plug the projector in and re-run," -ForegroundColor Yellow
    Write-Host "      or force it with: .\scripts\start-players.ps1 -Slot 2" -ForegroundColor Yellow
  }
}
if ($Slot -eq 0 -or $Slot -eq 3) {
  Start-Sleep -Milliseconds 500
  Start-AudioSlot
}

Write-Host ''
Write-Host 'Player kiosk started.' -ForegroundColor Green
Write-Host 'Stop with: .\scripts\start-players.ps1 -Stop' -ForegroundColor Gray
