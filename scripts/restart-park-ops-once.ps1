# restart-park-ops-once.ps1 (keep ASCII-only; GK PowerShell 5.1 GBK)
# Runs INTERACTIVELY in the console session via scheduled task SC-RestartParkOpsOnce.
# Kills ONLY the park-ops dashboard Edge (profile smart-control-park-ops), relaunches
# it via the canonical start-park-ops.ps1, then pins its window to the PRIMARY display's
# exact pixel rect (same Force-ExactFullscreen approach start-players uses for slots),
# because --start-fullscreen opens at the wrong size when the 3612x1462 EDID is not
# ready at boot and never re-pins. Captures before/after shots for verification.
$ErrorActionPreference = 'Continue'
$root = 'D:\smart-control'
$logDir = Join-Path $root 'logs'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type -Namespace GK -Name R -ErrorAction SilentlyContinue -MemberDefinition @"
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L,T,R,B; }
"@

function Get-ParkPids {
  @(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -match 'smart-control-park-ops' } |
    ForEach-Object { [int]$_.ProcessId })
}
function Get-Prim {
  ([System.Windows.Forms.Screen]::AllScreens | Where-Object { $_.Primary } | Select-Object -First 1).Bounds
}
function Save-Snap([string]$name) {
  try {
    $p = Get-Prim
    $b = New-Object System.Drawing.Bitmap $p.Width,$p.Height
    $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen($p.X,$p.Y,0,0,$b.Size)
    $nw = 1280; $nh = [int]($p.Height * ($nw / $p.Width))
    $r2 = New-Object System.Drawing.Bitmap $nw,$nh
    $g2 = [System.Drawing.Graphics]::FromImage($r2)
    $g2.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g2.DrawImage($b,0,0,$nw,$nh)
    $f = Join-Path $logDir $name
    $enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
    $ep = New-Object System.Drawing.Imaging.EncoderParameters 1
    $ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality,72L)
    $r2.Save($f,$enc,$ep); $n = (Get-Item $f).Length
    $g.Dispose();$g2.Dispose();$b.Dispose();$r2.Dispose(); return $n
  } catch { return -1 }
}

$o = [ordered]@{}
$o.when = (Get-Date).ToString('u')
$o.screens = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object {
  "{0}|prim={1}|{2},{3} {4}x{5}|{6}bpp" -f $_.DeviceName,$_.Primary,$_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height,$_.BitsPerPixel })
$o.beforePids = ((Get-ParkPids) -join ',')
$o.beforeShot = Save-Snap 'parkops-before.jpg'

Get-ParkPids | ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
& (Join-Path $root 'scripts\start-park-ops.ps1')
Start-Sleep -Seconds 3

$prim = Get-Prim
$SWP_FRAMECHANGED = 0x20; $SWP_SHOWWINDOW = 0x40
$pinLog = @()
$deadline = (Get-Date).AddSeconds(25)
while ((Get-Date) -lt $deadline) {
  $pids = Get-ParkPids
  if ($pids.Count -gt 0) {
    $h = [GK.R]::GetTopWindow([IntPtr]::Zero)
    while ($h -ne [IntPtr]::Zero) {
      if ([GK.R]::IsWindowVisible($h)) {
        $wp = 0; [GK.R]::GetWindowThreadProcessId($h,[ref]$wp) | Out-Null
        if ($pids -contains [int]$wp) {
          $r = New-Object GK.R+RECT; [GK.R]::GetWindowRect($h,[ref]$r) | Out-Null
          $w = $r.R-$r.L; $hh = $r.B-$r.T
          if ($w -gt 1000 -and $hh -gt 700) {
            if ([GK.R]::IsIconic($h)) { [GK.R]::ShowWindow($h,9) | Out-Null }
            [GK.R]::SetWindowPos($h,[IntPtr]::Zero,$prim.X,$prim.Y,$prim.Width,$prim.Height,($SWP_FRAMECHANGED -bor $SWP_SHOWWINDOW)) | Out-Null
            [GK.R]::SetForegroundWindow($h) | Out-Null
            Start-Sleep -Milliseconds 500
            [GK.R]::GetWindowRect($h,[ref]$r) | Out-Null
            $pinLog += ("pinned {0},{1} {2}x{3}" -f $r.L,$r.T,($r.R-$r.L),($r.B-$r.T))
          }
        }
      }
      $h = [GK.R]::GetWindow($h,2)
    }
    if ($pinLog.Count -gt 0) { break }
  }
  Start-Sleep -Milliseconds 800
}

Start-Sleep -Seconds 2
$after = @(); $apids = Get-ParkPids
$h = [GK.R]::GetTopWindow([IntPtr]::Zero)
while ($h -ne [IntPtr]::Zero) {
  if ([GK.R]::IsWindowVisible($h)) {
    $wp = 0; [GK.R]::GetWindowThreadProcessId($h,[ref]$wp) | Out-Null
    if ($apids -contains [int]$wp) {
      $r = New-Object GK.R+RECT; [GK.R]::GetWindowRect($h,[ref]$r) | Out-Null
      if (($r.R-$r.L) -gt 200) { $after += ("{0},{1} {2}x{3}" -f $r.L,$r.T,($r.R-$r.L),($r.B-$r.T)) }
    }
  }
  $h = [GK.R]::GetWindow($h,2)
}
$o.primary = ("{0},{1} {2}x{3}" -f $prim.X,$prim.Y,$prim.Width,$prim.Height)
$o.afterPids = ($apids -join ',')
$o.pin = $pinLog
$o.afterRects = $after
$o.afterShot = Save-Snap 'parkops-after.jpg'
Set-Content -Path (Join-Path $logDir 'parkops-restart.json') -Value ($o | ConvertTo-Json -Depth 5) -Encoding UTF8
Add-Content -Path (Join-Path $logDir 'parkops-restart.log') -Value ((Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' primary=' + $o.primary + ' after=' + ($after -join ';')) -Encoding UTF8
