# =====================================================================
# set-projector-res.ps1 -- raise the projector (non-primary) display to the
# best mode its EDID offers. File: scripts\set-projector-res.ps1
#
# Keep this file ASCII-only (GK9000 PowerShell 5.1 reads BOM-less UTF-8 as
# GBK; non-ASCII bytes can swallow newlines and break parsing).
#
# WHY: the HDMI2 -> fusion-box (JBT-SK-HD02) -> 2x WUXGA projector chain was
# observed running at 1280x720 while the blended canvas is ~2x1920x1200 --
# a ~2.7x upscale that visibly softens the picture (owner 2026-07-31).
#
# WHAT: enumerate every mode Windows/EDID exposes for the non-primary display
# (only EDID-approved modes appear in EnumDisplaySettings, so we can never
# pick something the fusion box did not advertise), prefer 1920x1200 > by
# area > by refresh, apply with CDS_UPDATEREGISTRY (persists across reboot),
# back up the previous mode for -Target restore.
#
# RUN CONTEXT: must run in the interactive console session (the player
# watchdog task qualifies); a service/SSH session cannot change display modes.
#
# Usage:
#   set-projector-res.ps1                # auto-pick best mode
#   set-projector-res.ps1 -Target restore  # roll back to the backed-up mode
# =====================================================================
param([string]$Target = 'auto')
$ErrorActionPreference = 'Continue'

$repoRoot = Split-Path -Parent $PSScriptRoot
$logFile = Join-Path $repoRoot 'logs\projector-res.log'
$bakFile = Join-Path $repoRoot 'logs\projector-res-backup.txt'
function Log([string]$msg) {
  $line = ('{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $msg)
  Write-Output $msg
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch {}
}

Add-Type -AssemblyName System.Windows.Forms
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[StructLayout(LayoutKind.Sequential, CharSet = CharSet.Ansi)]
public struct DEVMODE {
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmDeviceName;
  public short dmSpecVersion, dmDriverVersion, dmSize, dmDriverExtra;
  public int dmFields;
  public int dmPositionX, dmPositionY, dmDisplayOrientation, dmDisplayFixedOutput;
  public short dmColor, dmDuplex, dmYResolution, dmTTOption, dmCollate;
  [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string dmFormName;
  public short dmLogPixels;
  public int dmBitsPerPel, dmPelsWidth, dmPelsHeight, dmDisplayFlags, dmDisplayFrequency;
  public int dmICMMethod, dmICMIntent, dmMediaType, dmDitherType, dmReserved1, dmReserved2;
  public int dmPanningWidth, dmPanningHeight;
}
public static class DisplayApi {
  [DllImport("user32.dll", CharSet = CharSet.Ansi)]
  public static extern bool EnumDisplaySettings(string deviceName, int modeNum, ref DEVMODE devMode);
  [DllImport("user32.dll", CharSet = CharSet.Ansi)]
  public static extern int ChangeDisplaySettingsEx(string deviceName, ref DEVMODE devMode, IntPtr hwnd, uint flags, IntPtr lParam);
}
'@

$ENUM_CURRENT = -1
$CDS_UPDATEREGISTRY = 1

# locate the projector = first non-primary display
$sec = [System.Windows.Forms.Screen]::AllScreens | Where-Object { -not $_.Primary } | Select-Object -First 1
if (-not $sec) { Log 'no non-primary display found -> nothing to do'; exit 0 }
$dev = $sec.DeviceName
Log ('projector display: ' + $dev + ' current bounds ' + $sec.Bounds.Width + 'x' + $sec.Bounds.Height)

# read current mode
$cur = New-Object DEVMODE
$cur.dmSize = [short][System.Runtime.InteropServices.Marshal]::SizeOf([type][DEVMODE])
[void][DisplayApi]::EnumDisplaySettings($dev, $ENUM_CURRENT, [ref]$cur)
Log ('current mode: ' + $cur.dmPelsWidth + 'x' + $cur.dmPelsHeight + '@' + $cur.dmDisplayFrequency + 'Hz')

function Apply-Mode([int]$w, [int]$h, [int]$hz) {
  $dm = New-Object DEVMODE
  $dm.dmSize = [short][System.Runtime.InteropServices.Marshal]::SizeOf([type][DEVMODE])
  [void][DisplayApi]::EnumDisplaySettings($dev, $ENUM_CURRENT, [ref]$dm)
  $dm.dmPelsWidth = $w
  $dm.dmPelsHeight = $h
  $dm.dmDisplayFrequency = $hz
  # DM_PELSWIDTH(0x80000) | DM_PELSHEIGHT(0x100000) | DM_DISPLAYFREQUENCY(0x400000)
  $dm.dmFields = 0x80000 -bor 0x100000 -bor 0x400000
  $ret = [DisplayApi]::ChangeDisplaySettingsEx($dev, [ref]$dm, [IntPtr]::Zero, $CDS_UPDATEREGISTRY, [IntPtr]::Zero)
  return $ret
}

if ($Target -eq 'restore') {
  if (-not (Test-Path $bakFile)) { Log 'restore requested but no backup file'; exit 1 }
  $parts = (Get-Content $bakFile -Raw).Trim() -split 'x|@'
  if ($parts.Count -lt 3) { Log 'backup file malformed'; exit 1 }
  $ret = Apply-Mode ([int]$parts[0]) ([int]$parts[1]) ([int]$parts[2])
  Log ('restore ' + $parts[0] + 'x' + $parts[1] + '@' + $parts[2] + ' -> ret=' + $ret + ' (0=OK)')
  exit ([int]($ret -ne 0))
}

# enumerate every EDID-approved mode for this display
$modes = @()
$i = 0
$dm = New-Object DEVMODE
$dm.dmSize = [short][System.Runtime.InteropServices.Marshal]::SizeOf([type][DEVMODE])
while ([DisplayApi]::EnumDisplaySettings($dev, $i, [ref]$dm)) {
  $modes += [pscustomobject]@{ W = $dm.dmPelsWidth; H = $dm.dmPelsHeight; Hz = $dm.dmDisplayFrequency }
  $i++
}
Log ('EDID-approved modes: ' + $modes.Count)

# candidates: sane sizes and refresh; prefer native-height 1200, then area, then refresh
$cand = $modes | Where-Object { $_.W -ge 1280 -and $_.Hz -ge 50 }
if (-not $cand) { Log 'no candidate modes >=1280 wide -> EDID is capped, hardware-side fix needed'; exit 0 }
$best = $cand | Sort-Object `
  @{ Expression = { if ($_.H -eq 1200) { 1 } else { 0 } }; Descending = $true }, `
  @{ Expression = { $_.W * $_.H }; Descending = $true }, `
  @{ Expression = { $_.Hz }; Descending = $true } | Select-Object -First 1
Log ('best available: ' + $best.W + 'x' + $best.H + '@' + $best.Hz + 'Hz')

if ($best.W * $best.H -le $cur.dmPelsWidth * $cur.dmPelsHeight) {
  Log 'current mode is already the best EDID offers -> nothing to do'
  exit 0
}

# back up current mode BEFORE changing, then apply
try { Set-Content -Path $bakFile -Value ($cur.dmPelsWidth.ToString() + 'x' + $cur.dmPelsHeight + '@' + $cur.dmDisplayFrequency) -Encoding UTF8 } catch {}
$ret = Apply-Mode $best.W $best.H $best.Hz
Log ('apply ' + $best.W + 'x' + $best.H + '@' + $best.Hz + ' -> ret=' + $ret + ' (0=OK; backup in logs\projector-res-backup.txt)')
exit ([int]($ret -ne 0))
