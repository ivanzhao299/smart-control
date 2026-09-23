# =====================================================================
# Shared display geometry helpers for the GK9000 kiosk
# File: scripts/display-common.ps1
#
# NOTE: keep this file ASCII-only (GK9000 PowerShell 5.1 reads BOM-less
# files as GBK; see start-players.ps1 header).
#
# Dot-source from start-players.ps1, start-park-ops.ps1 and
# player-watchdog.ps1. Provides:
#   Get-DisplayRect    - bounds of the primary or first non-primary screen
#   Wait-DisplayReady  - do not pin a window before the EDID has negotiated
#   Get-MarkerPids     - browser PIDs whose command line carries a marker
#   Repair-MarkerRect  - hot-correct a marker's big content window rect
#
# Why (2026-09-23): after a power cut the fusion EDID briefly reported
# 1280x720. The boot launcher pinned slot1 to that wrong rect, and the
# watchdog only checked heartbeats (never the window rect), so once the
# EDID recovered to 3612x1462 the window stayed small and hidden behind
# the fullscreen dashboard. These helpers wait for the real mode at boot
# and re-verify the rect on every watchdog tick without killing anything.
# =====================================================================

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

try {
  Add-Type -Namespace DisplayWin -Name Native -ErrorAction Stop -MemberDefinition @'
[DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
[DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetTopWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetWindow(IntPtr h, uint c);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
'@
} catch { }

# Return the primary screen bounds, or the first non-primary screen with
# -NonPrimary. Returns $null when screens cannot be enumerated.
function Get-DisplayRect {
  param([switch]$NonPrimary)
  try {
    if ($NonPrimary) {
      $screen = [System.Windows.Forms.Screen]::AllScreens |
        Where-Object { -not $_.Primary } | Select-Object -First 1
    } else {
      $screen = [System.Windows.Forms.Screen]::AllScreens |
        Where-Object { $_.Primary } | Select-Object -First 1
    }
    if ($screen -and $screen.Bounds.Width -gt 0 -and $screen.Bounds.Height -gt 0) {
      return $screen.Bounds
    }
  } catch { }
  return $null
}

# Block until the primary screen negotiates the expected mode (EDID ready).
# Returns $true once matched, $false on timeout so the caller keeps its
# existing safe fallback instead of pinning to a transient low mode.
function Wait-DisplayReady {
  param([int]$ExpectedW = 3612,
        [int]$ExpectedH = 1462,
        [int]$TimeoutSec = 90,
        [int]$PollMs = 2000)
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $bounds = Get-DisplayRect
    if ($bounds -and $bounds.Width -ge $ExpectedW -and $bounds.Height -ge $ExpectedH) {
      return $true
    }
    Start-Sleep -Milliseconds $PollMs
  }
  return $false
}

# Browser PIDs whose command line contains the given user-data-dir marker.
function Get-MarkerPids {
  param([string]$Marker)
  return @(
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match [regex]::Escape($Marker) } |
      ForEach-Object { [int]$_.ProcessId }
  )
}

# Enumerate the marker's visible top-level content windows (larger than
# 300px) and, whenever the rect does not already equal the target, call
# SetWindowPos then read it back. Uses SWP_NOZORDER | SWP_NOACTIVATE so
# stacking and focus are untouched: safe every watchdog minute and on a
# window currently behind another fullscreen kiosk.
# Returns 'fixed' (a window was corrected), 'ok' (already correct) or
# 'missing' (no content window found for that marker).
function Repair-MarkerRect {
  param([string]$Marker, [int]$X, [int]$Y, [int]$W, [int]$H)
  $flags = 0x0004 -bor 0x0010 -bor 0x0020   # NOZORDER | NOACTIVATE | FRAMECHANGED
  $pids = Get-MarkerPids -Marker $Marker
  if (-not $pids -or $pids.Count -eq 0) { return 'missing' }
  $want = (${W}).ToString() + 'x' + (${H}).ToString()
  $state = 'missing'
  $win = [DisplayWin.Native]::GetTopWindow([IntPtr]::Zero)
  while ($win -ne [IntPtr]::Zero) {
    if ([DisplayWin.Native]::IsWindowVisible($win)) {
      $wpid = 0
      [DisplayWin.Native]::GetWindowThreadProcessId($win, [ref]$wpid) | Out-Null
      if ($pids -contains [int]$wpid) {
        $rect = New-Object DisplayWin.Native+RECT
        [DisplayWin.Native]::GetWindowRect($win, [ref]$rect) | Out-Null
        if (($rect.R - $rect.L) -gt 300 -and ($rect.B - $rect.T) -gt 300) {
          $got = ($rect.R - $rect.L).ToString() + 'x' + ($rect.B - $rect.T)
          if ($got -eq $want -and $rect.L -eq $X -and $rect.T -eq $Y) {
            if ($state -ne 'fixed') { $state = 'ok' }
          } else {
            [DisplayWin.Native]::SetWindowPos($win, [IntPtr]::Zero, $X, $Y, $W, $H, $flags) | Out-Null
            Start-Sleep -Milliseconds 300
            [DisplayWin.Native]::GetWindowRect($win, [ref]$rect) | Out-Null
            $now = ($rect.R - $rect.L).ToString() + 'x' + ($rect.B - $rect.T)
            if ($now -eq $want -and $rect.L -eq $X -and $rect.T -eq $Y) {
              $state = 'fixed'
            } elseif ($state -ne 'fixed') {
              $state = 'ok'   # best effort; a later tick retries
            }
          }
        }
      }
    }
    $win = [DisplayWin.Native]::GetWindow($win, 2)   # GW_HWNDNEXT
  }
  return $state
}
