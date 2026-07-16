# ==============================================================
# Configure the SmartControlBackend scheduled task to bootstrap pm2 as the
# 'user' account (not SYSTEM).
#
# Why user, not SYSTEM (2026-07-16):
#   pm2 keeps a per-account daemon. If the boot task runs as SYSTEM, the daemon
#   and services are SYSTEM-owned, but CI deploys and manual ops connect as
#   'user' -- their pm2 client cannot see or manage the SYSTEM daemon, and the
#   two fight over ports 3200/5173. Cold-boot testing confirmed SYSTEM-context
#   pm2 resurrect does not reliably bring services up either.
#
#   This machine has no auto-login, and the kiosk (SmartControl-PlayerWatchdog)
#   already runs as 'user' on a timer -- i.e. the operating model is "user is
#   logged in, then the display and services run". So we mirror that: run
#   boot-pm2.ps1 as 'user', at logon plus a repeating 5-minute backstop. The
#   script is idempotent (skips if 3200+5173 already listen), so repetition is
#   safe. boot-pm2.ps1 detaches the pm2 daemon via WMI so it survives the task
#   session ending.
#
# Run this ON GK9000 (elevated): powershell -ExecutionPolicy Bypass -File this
# NOTE: this file must stay ASCII-only (PowerShell 5.1 GBK codepage eats the
# newline after a non-ASCII comment and merges the next line -- cost hours once).
# ==============================================================
$ErrorActionPreference = 'Stop'
$taskName = 'SmartControlBackend'
$user = 'user'
$scriptPath = 'D:\smart-control\scripts\boot-pm2.ps1'

$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File $scriptPath"

# At logon (immediate when user signs in) + a repeating backstop every 5 min.
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1)
$repeat.Repetition = (New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5)).Repetition

# Interactive: runs in the user's session (no stored password needed), only when
# logged on -- which is the required state for this kiosk machine anyway.
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

Set-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atLogon, $repeat) `
  -Principal $principal -Settings $settings | Out-Null

Write-Output "Reconfigured '$taskName' to run boot-pm2.ps1 as '$user' (AtLogon + 5-min backstop)."
$t = Get-ScheduledTask -TaskName $taskName
Write-Output ("Principal: " + $t.Principal.UserId + " / " + $t.Principal.LogonType + " / " + $t.Principal.RunLevel)
Write-Output ("Action:    " + ($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }))
