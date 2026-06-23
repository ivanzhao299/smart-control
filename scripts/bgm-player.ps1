# =====================================================================
# bgm-player.ps1 — GK9000 background-music daemon (replaces Edge slot3 kiosk)
# File: scripts/bgm-player.ps1
#
# Keep this file ASCII-only (GK9000 PowerShell 5.1 reads BOM-less UTF-8 as GBK;
# non-ASCII comment bytes can swallow the next newline and break parsing).
#
# WHY NOT EDGE: slot1/2 run fullscreen TOPMOST kiosks across both monitors, so a
# slot3 Edge audio window can never stay visible, and Chromium pauses audio for
# any minimized / off-screen / occluded window. No workable spot exists.
#
# WHY NOT WPF MediaPlayer: it needs a Dispatcher (UI message pump) to keep
# playing; in a plain background loop it stops after a few seconds. (Single-shot
# 18s test worked by luck.)
#
# WHAT: uses the Windows MCI interface (winmm.dll mciSendString) — the lowest
# level audio API, needs NO window and NO message pump, made exactly for this.
# Polls the backend slot3 channel and mirrors it:
#   - new currentMediaId   -> download mp3 to temp + MCI open + play
#   - loopMode == 'loop'   -> when MCI reports 'stopped', seek to start + replay
#   - empty currentMediaId -> close
# Also posts the slot3 heartbeat so the PWA shows "player online".
# Runs as a hidden background powershell process (launched by start-players.ps1
# Start-AudioSlot, and on boot via the Startup folder).
# =====================================================================
$ErrorActionPreference = 'Continue'

Add-Type -MemberDefinition @'
[DllImport("winmm.dll", CharSet=CharSet.Auto)]
public static extern int mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
'@ -Name MCI -Namespace Win32Audio

function Invoke-Mci([string]$cmd) {
  $sb = New-Object System.Text.StringBuilder 256
  [Win32Audio.MCI]::mciSendString($cmd, $sb, 256, [IntPtr]::Zero) | Out-Null
  return $sb.ToString()
}

$apiBase = 'http://127.0.0.1:3200'
$tmpFile = Join-Path $env:TEMP 'sc-bgm.mp3'
$curId = $null
$curLoop = 'once'
$opened = $false
$localPaused = $false

function To-Abs([string]$u) {
  if ([string]::IsNullOrEmpty($u)) { return $null }
  if ($u -match '^https?://') { return $u }
  $p = $u -replace '^/control', ''
  if ($p -notmatch '^/') { $p = '/' + $p }
  return $apiBase + $p
}

# clear any stale MCI alias left by a previous daemon instance
Invoke-Mci 'close all' | Out-Null

while ($true) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing "$apiBase/api/playback/channels" -TimeoutSec 6
    $ch = ($resp.Content | ConvertFrom-Json).data | Where-Object { $_.slot -eq 3 }
    $mid = $ch.currentMediaId
    $murl = [string]$ch.currentMediaUrl
    $loop = [string]$ch.loopMode

    $wantPaused = [bool]($ch.paused)

    if (-not $mid -or [string]::IsNullOrEmpty($murl)) {
      # nothing selected -> stop
      if ($opened) { Invoke-Mci 'close bgm' | Out-Null; $opened = $false }
      $curId = $null; $localPaused = $false
    }
    elseif ("$mid" -ne "$curId") {
      # track changed (or first run) -> download + play
      if ($opened) { Invoke-Mci 'close bgm' | Out-Null; $opened = $false }
      $abs = To-Abs $murl
      if ($abs) {
        try {
          Invoke-WebRequest -UseBasicParsing $abs -OutFile $tmpFile -TimeoutSec 30
          Invoke-Mci ('open "' + $tmpFile + '" alias bgm') | Out-Null
          Invoke-Mci 'play bgm' | Out-Null
          $opened = $true; $curId = "$mid"; $curLoop = $loop; $localPaused = $false
        } catch {}
      }
    }
    else {
      # same track -> handle pause / resume / loop
      $curLoop = $loop
      if ($opened) {
        $mode = Invoke-Mci 'status bgm mode'
        if ($wantPaused -and $mode -match 'playing') {
          Invoke-Mci 'pause bgm' | Out-Null; $localPaused = $true
        }
        elseif (-not $wantPaused -and ($mode -match 'paused' -or $localPaused)) {
          Invoke-Mci 'resume bgm' | Out-Null; $localPaused = $false
        }
        elseif (-not $localPaused -and $mode -match 'stopped' -and $curLoop -eq 'loop') {
          Invoke-Mci 'seek bgm to start' | Out-Null
          Invoke-Mci 'play bgm' | Out-Null
        }
      }
    }

    # heartbeat so PWA audio page shows "player online"
    try { Invoke-WebRequest -UseBasicParsing -Method Post "$apiBase/api/playback/channels/3/heartbeat" -TimeoutSec 4 | Out-Null } catch {}
  } catch { }
  Start-Sleep -Seconds 3
}
