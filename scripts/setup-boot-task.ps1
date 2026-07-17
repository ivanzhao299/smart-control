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
#   So: run boot-pm2.ps1 as 'user', but with LogonType S4U -- "whether the user is
#   logged on or not". Triggers: AtStartup + AtLogon + a repeating 5-minute
#   backstop. The script is idempotent (skips if 3200+5173 already listen), so
#   repetition is safe. boot-pm2.ps1 detaches the pm2 daemon via WMI so it
#   survives the task session ending.
#
# Why NOT Interactive (2026-07-17, learned the hard way):
#   This machine has NO auto-login. It was set to Interactive on the assumption
#   that "someone is always logged in on a kiosk box". The box rebooted unattended
#   at 01:07 with nobody logged in -- AtLogon never fired, the 5-min backstop was
#   refused by the scheduler (Interactive = only while that user has a session),
#   pm2 was never resurrected, and 3200/5173 stayed DOWN for 11 hours until a
#   human noticed. Never gate the headless services on a human being logged in.
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

# At startup (no logon needed) + at logon + a repeating backstop every 5 min.
# The backstop covers "boot-pm2 failed once, retry" and is safe because the
# script is idempotent. RepetitionDuration must be finite for the scheduler.
$atStartup = New-ScheduledTaskTrigger -AtStartup
$atLogon = New-ScheduledTaskTrigger -AtLogOn -User $user
$repeat = New-ScheduledTaskTrigger -Once -At (Get-Date).AddMinutes(1) `
  -RepetitionInterval (New-TimeSpan -Minutes 5) -RepetitionDuration (New-TimeSpan -Days 3650)

# S4U = "run whether the user is logged on or not", still as 'user' (so PM2_HOME
# C:\Users\user\.pm2 and the npm install resolve) and with no stored password.
#
# It was LogonType Interactive until 2026-07-17, with a comment claiming a logged-on
# session "is the required state for this kiosk machine anyway". That assumption cost
# an 11-hour outage: the box rebooted unattended at 01:07, nobody logged in, so
#   - AtLogon never fired (no logon), and
#   - the 5-min backstop fired ~140 times but the scheduler REFUSED to run it,
#     because Interactive means "only when this user is logged on".
# pm2 was therefore never resurrected and 3200/5173 stayed dead until a human
# noticed. Backend/frontend are headless node processes -- they need no desktop --
# so S4U is correct here. (The PlayerWatchdog task is different: the LED kiosk
# windows DO need the console session, so that one must stay Interactive.)
$principal = New-ScheduledTaskPrincipal -UserId $user -LogonType S4U -RunLevel Highest

$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

# Register-ScheduledTask (unregister first) sets principal + triggers + action
# atomically -- Set-ScheduledTask choked on the multi-trigger + principal combo.
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($atStartup, $atLogon, $repeat) `
  -Principal $principal -Settings $settings | Out-Null

Write-Output "Reconfigured '$taskName' to run boot-pm2.ps1 as '$user' (AtStartup + AtLogon + 5-min backstop, S4U)."
$t = Get-ScheduledTask -TaskName $taskName
Write-Output ("Principal: " + $t.Principal.UserId + " / " + $t.Principal.LogonType + " / " + $t.Principal.RunLevel)
Write-Output ("Action:    " + ($t.Actions | ForEach-Object { $_.Execute + ' ' + $_.Arguments }))
