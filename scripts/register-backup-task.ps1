# =====================================================================
# Register / update the SmartControl-DailyBackup scheduled task (in place).
# File: scripts/register-backup-task.ps1
#
# Idempotent. The live GK task is named 'SmartControl-DailyBackup' and ran only
# once a day at 04:00, which left multi-day gaps when several days had no
# deploy/update (a deploy and an update each trigger an extra ad-hoc backup, but
# nothing else did). This repoints that SAME task in place (-Force, no duplicate
# task) to run several times a day; default every 6 hours at 00/06/12/18.
# Override with -AtHours / -TaskName.
#
# IMPORTANT: backup.ps1 never auto-deletes old snapshots on purpose (deletion
# needs an explicit, approved operation). SQLite snapshots are small; review
# D:\smart-control-backups disk usage periodically instead of pruning silently.
#
# Keep this file ASCII-only (GK9000 PowerShell 5.1 GBK issue).
# =====================================================================
[CmdletBinding()]
param(
  [string]$TaskName = 'SmartControl-DailyBackup',
  [int[]]$AtHours = @(0, 6, 12, 18),
  [string]$BackupDest = 'D:\smart-control-backups'
)

$ErrorActionPreference = 'Stop'
$backupScript = Join-Path $PSScriptRoot 'backup.ps1'
if (-not (Test-Path $backupScript)) { throw "missing backup script: $backupScript" }

# Hidden launch so the periodic run never flashes a console over the kiosk.
$vbsPath = Join-Path $PSScriptRoot 'run-hidden.vbs'
if (-not (Test-Path $vbsPath)) {
  $vbsBody = @'
' Hidden PowerShell launcher (shared). arg0 = target .ps1, remaining args passed through.
' Window style 0 = hidden, bWaitOnReturn = False. ASCII-only.
Option Explicit
Dim sh, i, sArgs
Set sh = CreateObject("WScript.Shell")
sArgs = ""
For i = 1 To WScript.Arguments.Count - 1
  sArgs = sArgs & " " & WScript.Arguments(i)
Next
sh.Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """" & sArgs, 0, False
'@
  Set-Content -Path $vbsPath -Value $vbsBody -Encoding ASCII
}

$argList = '"{0}" "{1}" -Dest "{2}"' -f $vbsPath, $backupScript, $BackupDest
$action = New-ScheduledTaskAction -Execute "$env:SystemRoot\System32\wscript.exe" -Argument $argList

# One daily trigger per requested hour.
$triggers = @()
foreach ($h in $AtHours) {
  if ($h -lt 0 -or $h -gt 23) { throw "invalid hour: $h" }
  $triggers += New-ScheduledTaskTrigger -Daily -At ('{0:00}:00' -f $h)
}

# LOCAL SYSTEM so backups still run with nobody signed in.
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -DontStopOnIdleEnd `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 30)

$existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $triggers `
  -Principal $principal -Settings $settings -Force | Out-Null

Write-Host ("Registered/updated scheduled task '{0}'." -f $TaskName)
Write-Host ("  runs daily at : {0}" -f (($AtHours | ForEach-Object { '{0:00}:00' -f $_ }) -join ', '))
Write-Host ("  backup script : {0}" -f $backupScript)
Write-Host ("  destination   : {0}" -f $BackupDest)
Write-Host "  old snapshots are retained (no automatic deletion)."
if ($existing) { Write-Host "  note: an older task with this name was replaced." }
