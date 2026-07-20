# ==============================================================
# Boot bootstrap for pm2 -- replaces start-backend.ps1 / start-frontend.ps1
# (the two "while(true){ node ... }" loops that ran outside pm2).
#
# Why (2026-07-16):
#   The old start-backend.ps1 was a `while($true){ node dist\main.js }` loop that
#   the scheduled task launched at boot, bypassing pm2 entirely. pm2 also managed
#   the same backend (autorestart). Two watchdogs fought over port 3200 and the
#   loser crash-looped on EADDRINUSE -- that was the real cause of "deploy did not
#   take": pm2 restart put new code in pm2's process, but the loop's process (old
#   code) held the port, so new code never came up. start-frontend.ps1 was the
#   same (ran vite directly, outside pm2).
#
#   Decision: pm2 is the single owner of both services. This script does one thing
#   at boot -- resurrect pm2 once from the last `pm2 save` -- with no second watchdog.
#
# Why WMI detach:
#   Windows OpenSSH / scheduled-task sessions kill the spawned process tree on exit.
#   A plain `pm2 resurrect` daemon would die with it, orphaning node (port held but
#   pm2 cannot manage it). Win32_Process.Create detaches the pm2 daemon from this
#   session so it survives.
#
# IMPORTANT: keep this file ASCII-only. PowerShell 5.1 on Chinese Windows reads
# .ps1 as the GBK codepage; a non-ASCII comment in a UTF-8 (no BOM) file eats the
# following newline and merges the next line into the comment -- which silently
# comments out real code. (2026-07-16: cost several rounds to diagnose.)
# ==============================================================
$ErrorActionPreference = 'Continue'
$logDir = 'D:\smart-control\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'boot-pm2.log'
function Log($m) { "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $m" | Out-File -Append -Encoding utf8 $log }

Log '[boot] start'

# Literal absolute paths -- do NOT read $env:APPDATA/$env:USERPROFILE (empty in
# non-interactive sessions). Set PM2_HOME literally so pm2 finds the existing
# daemon instead of spawning an orphan. GK9000 is a fixed single host (user 'user').
$pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }
$env:PM2_HOME = 'C:\Users\user\.pm2'
Log "[boot] pm2 = $pm2 ; PM2_HOME = $env:PM2_HOME"

# --- WireGuard keepalive (must stay ABOVE the early-exit below) ---
# GK9000 sits behind NAT. With no keepalive the NAT mapping expires after a few idle
# minutes and the jump host can no longer INITIATE a connection -- deploys time out and
# remote access dies -- even though the machine is online and its own outbound traffic
# (git fetch, heartbeat) works fine. That asymmetry is what made the tunnel look
# "sometimes up, sometimes down" for two days (2026-07-19/20) and cost several failed
# deploys before the cause was found.
#
# 25s is the WireGuard-recommended interval. `wg set` is a RUNTIME-only change: it does
# not survive a tunnel or host restart -- and this host gets powered off by hand fairly
# often. So re-apply it on every run: this script fires at boot AND on the 5-minute
# backstop trigger, and the call is idempotent.
#
# Deliberately placed before the "ports already listening -> exit 0" shortcut, otherwise
# the keepalive would be skipped exactly when the services are healthy (the common case).
$wgExe = 'C:\Program Files\WireGuard\wg.exe'
$wgPeer = 'pFHcSLdoGn19NXM64W2k0k+4XYu3SFBpzTAv8XtBliw='
if (Test-Path $wgExe) {
  try {
    & $wgExe set gk9000 peer $wgPeer persistent-keepalive 25 2>&1 | Out-Null
    Log '[boot] wireguard persistent-keepalive=25 applied'
  } catch {
    Log "[boot] wireguard keepalive failed: $($_.Exception.Message)"
  }
} else {
  Log '[boot] wg.exe not found, skip keepalive'
}

# Ports already listening = services already up (started manually / left running).
# Skip resurrect so we don't stack a second layer.
$backendUp = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$frontendUp = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
if ($backendUp -and $frontendUp) {
  Log '[boot] 3200 + 5173 already listening, skip resurrect'
  exit 0
}

# Run pm2 resurrect detached from this session (survives session exit).
$cmd = "cmd /c `"$pm2`" resurrect"
try {
  $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\user', $null)
  Log "[boot] WMI resurrect started, ProcessId=$($r.ProcessId) ReturnValue=$($r.ReturnValue)"
} catch {
  Log "[boot] WMI resurrect failed: $($_.Exception.Message)"
}

# Give services time to come up, then a simple confirm (verify-deploy.js is authoritative).
Start-Sleep -Seconds 12
$b = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$f = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
Log "[boot] result: backend(3200)=$b frontend(5173)=$f"
Log '[boot] done'
