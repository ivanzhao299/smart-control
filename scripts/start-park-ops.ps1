# Launch park-ops operations dashboard fullscreen (ASCII-only)
# GK9000 PowerShell 5.1 reads BOM-less files as GBK; keep this file ASCII.
# Idempotent: if the dashboard Edge process is already running it is left
# running, but its window rect is still hot-corrected to the primary display.
$ErrorActionPreference = "Continue"
. (Join-Path $PSScriptRoot 'display-common.ps1')

$edge = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe" }
$url = "http://localhost:5173/control/park-ops/"
$userData = "$env:LOCALAPPDATA\smart-control-park-ops"
$marker = "smart-control-park-ops"

# Do not create or re-pin the window before the wall EDID has negotiated.
Wait-DisplayReady -ExpectedW 3612 -ExpectedH 1462 -TimeoutSec 90 | Out-Null
$primary = Get-DisplayRect
if (-not $primary) { Write-Output "park-ops-no-primary-display"; exit 1 }

$running = Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($marker) }
if ($running) {
  $state = Repair-MarkerRect -Marker $marker -X $primary.X -Y $primary.Y -W $primary.Width -H $primary.Height
  Write-Output "park-ops-dashboard-already-running rect=$state"
  exit 0
}

$argList = @(
  "--app=$url",
  "--window-position=$($primary.X),$($primary.Y)",
  "--window-size=$($primary.Width),$($primary.Height)",
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
Start-Sleep -Seconds 3
$state = Repair-MarkerRect -Marker $marker -X $primary.X -Y $primary.Y -W $primary.Width -H $primary.Height
Write-Output "park-ops-dashboard-launched rect=$state"
