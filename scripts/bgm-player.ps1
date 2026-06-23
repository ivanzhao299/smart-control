# =====================================================================
# bgm-player.ps1 — GK9000 background-music daemon (replaces Edge slot3 kiosk)
# File: scripts/bgm-player.ps1
#
# Keep this file ASCII-only (GK9000 PowerShell 5.1 reads BOM-less UTF-8 as GBK;
# non-ASCII comment bytes can swallow the next newline and break parsing).
#
# WHY: the Edge --app/kiosk approach for slot3 audio is unworkable on this box.
# slot1/2 run fullscreen TOPMOST kiosks across both monitors, so the slot3 audio
# window can never stay visible; Chromium pauses/throttles audio for any window
# that is minimized, off-screen, OR fully occluded -> "plays a few seconds then
# stops / never plays". A WPF MediaPlayer has NO window at all, so none of that
# applies -> audio just plays. Verified on-site 2026-06-23 (user heard it).
#
# WHAT: polls the backend slot3 playback channel and mirrors it with a windowless
# System.Windows.Media.MediaPlayer:
#   - new currentMediaId   -> Open + Play the new track
#   - loopMode == 'loop'   -> restart when the track finishes
#   - empty currentMediaId -> Stop
# Also posts the slot3 heartbeat so the PWA shows "player online".
#
# Runs as a hidden background powershell process (no console window). Launched by
# start-players.ps1 (Start-AudioSlot) and on boot via the Startup folder.
# =====================================================================
$ErrorActionPreference = 'Continue'
Add-Type -AssemblyName PresentationCore

$apiBase = 'http://127.0.0.1:3200'
$player = New-Object System.Windows.Media.MediaPlayer
$player.Volume = 1.0

$curId = $null
$curLoop = 'once'

function To-Abs([string]$u) {
  if ([string]::IsNullOrEmpty($u)) { return $null }
  if ($u -match '^https?://') { return $u }
  $p = $u -replace '^/control', ''
  if ($p -notmatch '^/') { $p = '/' + $p }
  return $apiBase + $p
}

while ($true) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing "$apiBase/api/playback/channels" -TimeoutSec 6
    $ch = ($resp.Content | ConvertFrom-Json).data | Where-Object { $_.slot -eq 3 }
    $mid = $ch.currentMediaId
    $murl = [string]$ch.currentMediaUrl
    $loop = [string]$ch.loopMode

    if (-not $mid -or [string]::IsNullOrEmpty($murl)) {
      # no track selected -> stop
      if ($null -ne $curId) { try { $player.Stop() } catch {}; $curId = $null }
    }
    elseif ("$mid" -ne "$curId") {
      # track changed (or first run) -> play it
      $abs = To-Abs $murl
      if ($abs) {
        try {
          $player.Stop()
          $player.Open([uri]$abs)
          Start-Sleep -Milliseconds 700
          $player.Play()
          $curId = "$mid"
          $curLoop = $loop
        } catch {}
      }
    }
    else {
      # same track still selected -> loop it if it has finished
      $curLoop = $loop
      try {
        if ($player.NaturalDuration.HasTimeSpan) {
          $dur = $player.NaturalDuration.TimeSpan.TotalSeconds
          $pos = $player.Position.TotalSeconds
          if ($dur -gt 0 -and $pos -ge ($dur - 0.6)) {
            if ($curLoop -eq 'loop') {
              $player.Position = [TimeSpan]::Zero
              $player.Play()
            }
          }
        }
      } catch {}
    }

    # heartbeat so PWA audio page shows "player online"
    try { Invoke-WebRequest -UseBasicParsing -Method Post "$apiBase/api/playback/channels/3/heartbeat" -TimeoutSec 4 | Out-Null } catch {}
  } catch { }
  Start-Sleep -Seconds 3
}
