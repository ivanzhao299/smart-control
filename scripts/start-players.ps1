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
# !!! NEVER RUN THIS OVER SSH !!!  (2026-07-17, cost two hours of dead air)
# An SSH shell lands in session 0. Windows created there can NEVER render to the
# physical console (session 2) where the LED wall lives, and Chromium throttles
# a window it considers permanently invisible -- so the video plays for a few
# seconds, the audio cuts out, and the wall shows the bare desktop instead.
# Worse, this script kills all slots FIRST, so an SSH run destroys the good
# session-2 players and replaces them with useless session-0 ones.
# Measured that day: SSH session = 0, console = 2, msedge players all in 0.
#
# Launch it only from something that runs INTERACTIVELY IN THE CONSOLE SESSION:
#   - the SmartControl-PlayerWatchdog scheduled task (user / Interactive), or
#   - a shell on the physical console / an RDP session that owns session 2.
# To recover remotely, let the watchdog do it: it relaunches on its own once a
# slot heartbeat is stale for -StaleMinutes (default 3).
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
# Win32 helpers used by Force-ExactFullscreen (below).
Add-Type -Name Win -Namespace Kiosk -ErrorAction SilentlyContinue -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
'@

# Pin a slot's window to the monitor's EXACT pixel rect.
#
# Why this exists (2026-07-16): --start-fullscreen does NOT give a real
# 1920x1080 window on this box -- measured 1920x1079, i.e. one pixel short at the
# bottom, both before AND after the taskbar was set to auto-hide (so it is not a
# work-area/taskbar effect, Chromium just sizes it that way). That leftover 1px
# row shows whatever is behind the player: with the taskbar auto-hidden, its
# reveal sliver bleeds through as a thin BLUE line along the bottom of the LED
# wall -- which is exactly what the site reported.
#
# So stop negotiating with Chromium's idea of fullscreen and set the rect
# ourselves. SWP_NOZORDER keeps the existing stacking (slot ordering still
# matters), SWP_NOACTIVATE avoids stealing focus.
# Find the PIDs that belong to one slot, by the user-data-dir marker in their
# command line. Must NOT use the PID that Start-Process returned: Edge re-parents
# itself, so the window usually belongs to a DIFFERENT process than the one we
# launched (measured 2026-07-16: --app process 6820, window owned by 13776).
# This is the same discriminator Stop-Players uses.
function Get-SlotPids {
  param([int]$N)
  $marker = "smart-control-player-slot$N"
  return @(
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($marker) } |
      ForEach-Object { [int]$_.ProcessId }
  )
}

function Force-ExactFullscreen {
  param([int]$N, [int]$X, [int]$Y, [int]$W, [int]$H, [int]$TimeoutMs = 15000)
  $SWP_NOZORDER = 0x0004; $SWP_NOACTIVATE = 0x0010; $SWP_FRAMECHANGED = 0x0020
  $deadline = (Get-Date).AddMilliseconds($TimeoutMs)
  while ((Get-Date) -lt $deadline) {
    $pids = Get-SlotPids -N $N
    if ($pids.Count -gt 0) {
      $h = [Kiosk.Win]::GetTopWindow([IntPtr]::Zero)
      while ($h -ne [IntPtr]::Zero) {
        if ([Kiosk.Win]::IsWindowVisible($h)) {
          $wpid = 0
          [Kiosk.Win]::GetWindowThreadProcessId($h, [ref]$wpid) | Out-Null
          if ($pids -contains [int]$wpid) {
            $r = New-Object Kiosk.Win+RECT
            [Kiosk.Win]::GetWindowRect($h, [ref]$r) | Out-Null
            # only the big content window, not tooltips / hidden helpers
            if (($r.R - $r.L) -gt 300 -and ($r.B - $r.T) -gt 300) {
              [Kiosk.Win]::SetWindowPos($h, [IntPtr]::Zero, $X, $Y, $W, $H,
                ($SWP_NOZORDER -bor $SWP_NOACTIVATE -bor $SWP_FRAMECHANGED)) | Out-Null
              Start-Sleep -Milliseconds 400
              [Kiosk.Win]::GetWindowRect($h, [ref]$r) | Out-Null
              $got = ($r.R - $r.L).ToString() + 'x' + ($r.B - $r.T).ToString()
              $want = "${W}x${H}"
              if ($got -eq $want) {
                Write-Host ("  slot=$N pinned to " + $r.L + "," + $r.T + " " + $got) -ForegroundColor Green
              } else {
                Write-Host ("  slot=$N pin gave $got, wanted $want") -ForegroundColor Yellow
              }
              return $true
            }
          }
        }
        $h = [Kiosk.Win]::GetWindow($h, 2)   # GW_HWNDNEXT
      }
    }
    Start-Sleep -Milliseconds 500
  }
  Write-Host "  (slot=$N window not found to pin; leaving as-is)" -ForegroundColor Yellow
  return $false
}

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
  Start-Sleep -Milliseconds 2500
  Force-ExactFullscreen -N $N -X $X -Y $Y -W $W -H $H | Out-Null
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

# slot2 lives on the projector display, which is the NON-primary monitor (the LED
# is primary at 0,0). Return its REAL bounds so we adapt to whatever position /
# resolution it currently has, instead of the hard-coded 1920,0 1920x1080.
# 2026-07-23: inserting an HDMI audio de-embedder on the HDMI2 line renegotiated
# the fusion-box EDID; the projector display moved off 1920,0 and the fixed-coord
# window landed on the bare desktop (a taskbar line, no picture). Keying on the
# actual second-display bounds survives that. Also prints every screen it sees so
# the layout is visible in the log. Returns $null when it cannot enumerate or when
# there is no second display (projector unplugged).
function Get-ProjectorRect {
  try {
    $all = [System.Windows.Forms.Screen]::AllScreens
    foreach ($s in $all) {
      Write-Host ("  screen: primary=" + $s.Primary + " " + $s.Bounds.X + "," + $s.Bounds.Y + " " + $s.Bounds.Width + "x" + $s.Bounds.Height) -ForegroundColor DarkGray
    }
    $sec = $all | Where-Object { -not $_.Primary } | Select-Object -First 1
    if ($sec) { return $sec.Bounds }
  } catch { return $null }
  return $null
}

# slot1/2 fullscreen (LED + projector), then slot3 audio LAST so its small visible
# window stays ON TOP in the LED bottom-right corner (it must stay visible or
# Chromium pauses its audio).
if ($Slot -eq 0 -or $Slot -eq 1) {
  Start-Slot -N 1 -X $Slot1X -Y $Slot1Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 2) {
  # slot2 = projector on the NON-primary display. Use its real bounds so it tracks
  # EDID / resolution / position changes (e.g. inserting the HDMI audio splitter).
  # -Slot 2 (explicit) still starts even if no 2nd display is enumerable, falling
  # back to the -Slot2X/-ScreenW defaults; -Slot 0 (start all) skips when there is
  # no projector display so it can't cover slot1 on the LED.
  $pr = Get-ProjectorRect
  if ($pr) {
    Write-Host ("slot=2 -> projector display " + $pr.X + "," + $pr.Y + " " + $pr.Width + "x" + $pr.Height) -ForegroundColor Cyan
    Start-Sleep -Milliseconds 500
    Start-Slot -N 2 -X $pr.X -Y $pr.Y -W $pr.Width -H $pr.Height
  } elseif ($Slot -eq 2) {
    Write-Host ("slot=2 forced but no 2nd display enumerable -> defaults " + $Slot2X + "," + $Slot2Y + " " + $ScreenW + "x" + $ScreenH) -ForegroundColor Yellow
    Start-Sleep -Milliseconds 500
    Start-Slot -N 2 -X $Slot2X -Y $Slot2Y -W $ScreenW -H $ScreenH
  } else {
    Write-Host "SKIP slot=2: no second (projector) display found." -ForegroundColor Yellow
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
