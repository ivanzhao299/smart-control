# =====================================================================
# GK9000 graceful weekly reboot
# File: scripts/weekly-graceful-reboot.ps1
#
# Replaces the old hard WeeklyReboot action "shutdown /r /t 0 /f", which
# killed PM2/Node instantly and (combined with no AI auto-start) left the
# AI analysis down after boot; see docs/INCIDENT_2026-09-13_RECAP.md.
#
# Graceful sequence:
#   1. pm2 save  -> persist the current PM2 process list (for resurrect)
#   2. wait N s  -> drain in-flight HTTP requests and flush the SQLite WAL
#   3. Restart-Computer -Force (fallback: shutdown /r /t 5 /f)
#
# The scheduled task runs as LOCAL SYSTEM so it still fires at 00:00 with no
# interactive logon. PM2 itself belongs to the "user" account, therefore we
# point PM2_HOME at that user's .pm2 and call pm2.cmd by its absolute path;
# LOCAL SYSTEM has full access to that directory.
#
# Keep this file ASCII-only (GK9000 PowerShell 5.1 GBK issue).
# Registered for Monday 00:00 by scripts/register-weekly-reboot.ps1.
# =====================================================================
[CmdletBinding()]
param(
  [int]$GraceSeconds = 30,
  [string]$Pm2User = 'user',
  [switch]$DryRun
)

$ErrorActionPreference = 'Continue'
$RepoRoot = Split-Path -Parent $PSScriptRoot
$LogDir = Join-Path $RepoRoot 'logs'
if (-not (Test-Path $LogDir)) { New-Item -ItemType Directory -Path $LogDir -Force | Out-Null }
$LogFile = Join-Path $LogDir 'weekly-graceful-reboot.log'

function Log([string]$msg) {
  $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  try { Add-Content -Path $LogFile -Value $line -Encoding UTF8 } catch {}
  Write-Host $line
}

# PM2 process list belongs to the interactive "user" account; make sure a
# SYSTEM-run task reads/writes that same PM2_HOME instead of systemprofile's.
if (-not $env:PM2_HOME) {
  $env:PM2_HOME = Join-Path $env:SystemDrive ("Users\" + $Pm2User + "\.pm2")
}

function Resolve-Pm2 {
  $cmd = Get-Command pm2.cmd -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $fallback = Join-Path $env:SystemDrive ("Users\" + $Pm2User + "\AppData\Roaming\npm\pm2.cmd")
  if (Test-Path $fallback) { return $fallback }
  return $null
}

Log "=== graceful weekly reboot start (GraceSeconds=$GraceSeconds, Pm2User=$Pm2User, DryRun=$DryRun, PM2_HOME=$env:PM2_HOME) ==="

$pm2 = Resolve-Pm2
if ($pm2) {
  try {
    Log "pm2 save via: $pm2"
    & $pm2 save 2>&1 | ForEach-Object { Log ("  [pm2] " + $_) }
    Log "pm2 save finished (exit=$LASTEXITCODE)"
  } catch {
    Log "pm2 save failed, continue with grace period: $($_.Exception.Message)"
  }
} else {
  Log 'pm2.cmd not found; skip pm2 save and proceed to the grace period'
}

Log "waiting $GraceSeconds seconds before reboot to drain requests and flush WAL..."
for ($i = $GraceSeconds; $i -gt 0; $i--) {
  Start-Sleep -Seconds 1
  if (($i % 5) -eq 0) { Log "  reboot in ${i}s" }
}

if ($DryRun) {
  Log 'DryRun set -> NOT rebooting. Done.'
  exit 0
}

Log 'issuing Restart-Computer -Force'
try {
  Restart-Computer -Force
} catch {
  Log "Restart-Computer failed, falling back to shutdown /r /t 5 /f: $($_.Exception.Message)"
  & shutdown.exe /r /t 5 /f
}
