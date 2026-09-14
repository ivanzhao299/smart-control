# Launch park-ops operations dashboard fullscreen (ASCII-only)
# GK9000 PowerShell 5.1 reads BOM-less files as GBK; keep this file ASCII.
# Idempotent: exits silently if the dashboard Edge process is already running.
$ErrorActionPreference = "Continue"
$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe" }
$url = "http://localhost:5173/control/park-ops/"
$userData = "$env:LOCALAPPDATA\smart-control-park-ops"
$running = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match "smart-control-park-ops" }
if ($running) { Write-Output "park-ops-dashboard-already-running"; exit 0 }
$argList = @(
  "--app=$url",
  "--window-position=0,0",
  "--window-size=3612,1462",
  "--start-fullscreen",
  "--user-data-dir=$userData",
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-features=TranslateUI,AutofillServerCommunication",
  "--autoplay-policy=no-user-gesture-required",
  "--disable-pinch",
  "--disable-restore-session-state",
  "--test-type"
)
Start-Process -FilePath $edge -ArgumentList $argList
Write-Output "park-ops-dashboard-launched"
