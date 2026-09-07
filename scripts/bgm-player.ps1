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
#   - track ended         -> authenticated, session-bound backend advance
#   - empty currentMediaId -> close
# Also posts the slot3 heartbeat so the PWA shows "player online".
# Runs as a hidden background powershell process (launched by start-players.ps1
# Start-AudioSlot, and on boot via the Startup folder).
# =====================================================================
$ErrorActionPreference = 'Continue'
$releaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $PSScriptRoot 'assert-release-not-held.ps1') -ReleaseProjectRoot $releaseRoot
if (-not $?) { exit 1 }

Add-Type -MemberDefinition @'
[DllImport("winmm.dll", CharSet=CharSet.Auto)]
public static extern int mciSendString(string command, System.Text.StringBuilder buffer, int bufferSize, IntPtr hwndCallback);
'@ -Name MCI -Namespace Win32Audio

function Invoke-Mci([string]$cmd) {
  $sb = New-Object System.Text.StringBuilder 256
  [Win32Audio.MCI]::mciSendString($cmd, $sb, 256, [IntPtr]::Zero) | Out-Null
  return $sb.ToString()
}

# Lightweight log. This daemon used to have NO logging at all -- when background
# music misbehaved, the only tools were an audio-endpoint peak probe + guesswork
# (cost a full day once). Log STATE CHANGES only (never the every-3s poll):
# track changes, download / MCI failures, advance, backend up/down transitions.
$logFile = Join-Path (Split-Path -Parent $PSScriptRoot) 'logs\bgm-player.log'
function Log([string]$msg) {
  try { Add-Content -Path $logFile -Value (('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)) -Encoding UTF8 } catch {}
}
# roll the log if it got big, so a months-running daemon can't fill the disk
try { if ((Test-Path $logFile) -and (Get-Item $logFile).Length -gt 1MB) { Clear-Content $logFile -ErrorAction SilentlyContinue } } catch {}
Log 'bgm-player started'

# MCI with return-code check. mciSendString returns 0 on success, non-zero on
# error; plain Invoke-Mci above throws that away, so a failed open/play went
# SILENT -- the daemon set "now playing X" but nothing actually came out, and it
# sat stuck forever. Use this for the state-changing commands (open/play/close)
# so failures get logged and the track is retried instead of faked.
function Invoke-MciChecked([string]$cmd, [string]$label) {
  $sb = New-Object System.Text.StringBuilder 256
  $code = [Win32Audio.MCI]::mciSendString($cmd, $sb, 256, [IntPtr]::Zero)
  if ($code -ne 0) { Log ('MCI FAIL [' + $label + '] code=' + $code) }
  return ($code -eq 0)
}

$apiBase = 'http://127.0.0.1:3200'
# Provision this file outside the checkout with an ACL limited to the player account.
# Never put the credential in command arguments, URLs or logs.
try {
  $credentialFile = & (Join-Path $PSScriptRoot 'resolve-player-token-file.ps1')
  if (-not $?) { throw 'invalid player credential configuration' }
} catch { Log 'invalid player credential file configuration'; exit 1 }
function Get-PlayerHeaders {
  $token = [System.IO.File]::ReadAllText($credentialFile).Trim()
  if ($token.Length -lt 32 -or $token.Length -gt 512) { throw 'invalid player credential file' }
  return @{ 'X-Player-Token' = $token }
}
function Advance-Player([string]$session) {
  if (-not $session) { throw 'missing playback session' }
  $body = @{ playbackSession = $session } | ConvertTo-Json -Compress
  Invoke-WebRequest -UseBasicParsing -Method Post "$apiBase/api/player-device/3/advance" -Headers (Get-PlayerHeaders) -ContentType 'application/json' -Body $body -TimeoutSec 6 -ErrorAction Stop | Out-Null
}
# MCI picks its decoder BY FILE EXTENSION (waveaudio for .wav, MPEGVideo for
# .mp3/.wma/...). The temp name used to be hard-coded 'sc-bgm.mp3', so a .wav
# track saved under a .mp3 name hit the wrong decoder and never played
# (2026-07-31 owner report). Keep the track's real extension on the temp file.
$tmpBase = Join-Path $env:TEMP ('sc-bgm-' + [Guid]::NewGuid().ToString('N'))
$tmpFile = $tmpBase + '.mp3'
function Remove-CurrentDownload {
  # Only this process's exact file, never a wildcard or shared temp directory.
  if (Test-Path -LiteralPath $tmpFile) { Remove-Item -LiteralPath $tmpFile -Force -ErrorAction SilentlyContinue }
}
$curId = $null
$curSession = $null
$opened = $false
$localPaused = $false
$backendReachable = $true   # only used to log up/down transitions once each

function To-Abs([string]$u) {
  if ([string]::IsNullOrEmpty($u)) { return $null }
  # Accept only the local slot3 ticket route, never arbitrary external URLs.
  if ($u -notmatch '^/api/player-device/3/stream\?ticket=[A-Za-z0-9_-]{43}$') { throw 'invalid playback URL' }
  return $apiBase + $u
}

# clear any stale MCI alias left by a previous daemon instance
Invoke-Mci 'close all' | Out-Null

while ($true) {
  try {
    $resp = Invoke-WebRequest -UseBasicParsing "$apiBase/api/player-device/3/state" -Headers (Get-PlayerHeaders) -TimeoutSec 6 -ErrorAction Stop
    if (-not $backendReachable) { Log 'backend reachable again'; $backendReachable = $true }
    $ch = ($resp.Content | ConvertFrom-Json).data
    if ($ch.slot -ne 3) { throw 'invalid player state' }
    $session = [string]$ch.playbackSession
    $mid = $ch.currentMediaId
    $murl = [string]$ch.currentMediaUrl
    $mname = [string]$ch.currentMediaName

    $wantPaused = [bool]($ch.paused)

    if (-not $mid -or [string]::IsNullOrEmpty($murl)) {
      # nothing selected -> stop
      if ($opened) { Invoke-Mci 'close bgm' | Out-Null; $opened = $false }
      Remove-CurrentDownload
      $curId = $null; $curSession = $null; $localPaused = $false
    }
    elseif (-not $session) { throw 'missing playback session' }
    elseif ("$mid" -ne "$curId" -or $session -ne $curSession) {
      # track changed (or first run) -> download + play
      if ($opened) { Invoke-Mci 'close bgm' | Out-Null; $opened = $false }
      Remove-CurrentDownload
      $abs = To-Abs $murl
      if ($abs) {
        try {
          # keep the real extension so MCI opens the right decoder (see $tmpBase note).
          # PRIMARY source is currentMediaName (original filename, e.g. "xxx.wav") --
          # the media URL is /api/media/<id>/file with NO extension at all, so the
          # first version of this fix (URL-only) never actually found one (2026-07-31).
          $ext = ''
          try {
            $e = [System.IO.Path]::GetExtension($mname).ToLower()
            if ($e -match '^\.[a-z0-9]{2,5}$') { $ext = $e }
          } catch {}
          if (-not $ext) {
            try {
              $e2 = [System.IO.Path]::GetExtension(([Uri]$abs).AbsolutePath).ToLower()
              if ($e2 -match '^\.[a-z0-9]{2,5}$') { $ext = $e2 }
            } catch {}
          }
          if (-not $ext) { $ext = '.mp3' }
          $tmpFile = $tmpBase + $ext
          Invoke-WebRequest -UseBasicParsing $abs -OutFile $tmpFile -TimeoutSec 30 -ErrorAction Stop
          # A new user may take over during download. Revalidate before making sound.
          $check = (Invoke-WebRequest -UseBasicParsing "$apiBase/api/player-device/3/state" -Headers (Get-PlayerHeaders) -TimeoutSec 6 -ErrorAction Stop).Content | ConvertFrom-Json
          if ($check.data.playbackSession -ne $session) { throw 'playback session changed during download' }
          $wantPaused = [bool]$check.data.paused
          # open + play WITH return-code checks. If either fails, do NOT fake
          # "now playing" -- close, leave $curId null so the next poll retries,
          # instead of sitting stuck forever on a track that never started.
          $ok = Invoke-MciChecked ('open "' + $tmpFile + '" alias bgm') 'open'
          if ($ok -and -not $wantPaused) { $ok = Invoke-MciChecked 'play bgm' 'play' }
          if ($ok) {
            $opened = $true; $curId = "$mid"; $curSession = $session; $localPaused = $false
            if ($wantPaused) { $localPaused = $true }
            Log ('playing media ' + $mid)
          } else {
            Invoke-Mci 'close bgm' | Out-Null
            $opened = $false; $curId = $null
            # MCI cannot decode this file (codec not supported, e.g. flac/ogg on
            # a bare Win10). Retrying forever would stall BGM on this one track
            # AND re-download it every 3s -- ask the backend to advance instead,
            # so the playlist skips the unplayable track and keeps going.
            try {
              Advance-Player $session
              Log ('unplayable media ' + $mid + ' -> asked backend to advance')
            } catch {}
            Start-Sleep -Milliseconds 500  # don't hot-loop the CPU on a bad track
          }
        } catch {
          Log ('download or authorization failed for media ' + $mid)
          Invoke-Mci 'close bgm' | Out-Null
          Remove-CurrentDownload
          $opened = $false; $curId = $null; $curSession = $null
        }
      }
    }
    else {
      # same track -> handle pause / resume / loop
      if ($opened) {
        $mode = Invoke-Mci 'status bgm mode'
        if ($wantPaused -and $mode -match 'playing') {
          Invoke-Mci 'pause bgm' | Out-Null; $localPaused = $true
        }
        elseif (-not $wantPaused -and ($mode -match 'paused' -or $localPaused)) {
          if ($mode -match 'paused') { Invoke-Mci 'resume bgm' | Out-Null }
          else { Invoke-Mci 'play bgm' | Out-Null }
          $localPaused = $false
        }
        elseif (-not $localPaused -and $mode -match 'stopped') {
          # Current track finished -> let the BACKEND advance per the play mode
          # (seq / loop1 / loopAll / shuffle). This is the core of the 2026-07-18
          # root-cause fix: the "what plays next" logic now lives in the backend
          # and is driven by THIS daemon -- the thing that actually makes sound --
          # NOT by a setInterval in whoever's browser has the audio page open.
          # That browser dependency was the real root cause of the day-long
          # "BGM keeps going silent" saga: close the tab and there was simply no
          # next track, so it stopped for good. Now bgm-player itself asks the
          # backend to advance, so background music plays on with nobody watching.
          #
          # After POST advance the backend has set the new currentMediaId (or
          # republished the same one for loop1, or gone idle for seq-finished).
          # We clear $curId to null so the NEXT poll unconditionally reloads and
          # plays whatever the backend now points at -- next-track / replay /
          # idle(null) all fall out of the existing top-level branches, and
          # clearing $curId also debounces (next loop takes the "changed" branch,
          # not this "stopped" branch, so advance can't double-fire).
          # Failed authorization must not silently replay a private cached file.
          try {
            Advance-Player $curSession
            $curId = $null; $curSession = $null
            Log 'track finished -> asked backend to advance'
          } catch {
            Log 'advance rejected or unavailable; waiting for authorized state'
            Invoke-Mci 'close bgm' | Out-Null
            Remove-CurrentDownload
            $opened = $false; $curId = $null; $curSession = $null
          }
        }
      }
    }

    # heartbeat so PWA audio page shows "player online"
    try { Invoke-WebRequest -UseBasicParsing -Method Post "$apiBase/api/player-device/3/heartbeat" -Headers (Get-PlayerHeaders) -TimeoutSec 4 -ErrorAction Stop | Out-Null } catch {}
  } catch {
    # backend momentarily down (deploy / restart) is normal; log the transition
    # ONCE, not every 3s. Stop cached private audio until authorization recovers.
    if ($backendReachable) { Log 'backend unavailable or authorization denied'; $backendReachable = $false }
    # Do not keep private audio playing after account/device revocation.
    Invoke-Mci 'close bgm' | Out-Null
    Remove-CurrentDownload
    $opened = $false; $curId = $null; $curSession = $null; $localPaused = $false
  }
  Start-Sleep -Seconds 3
}
