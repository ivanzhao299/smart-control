# =====================================================================
# ppt-player.ps1 — 文档投屏守护 (2026-07-25, 业主: "PPT 必须保留动画")
#
# 跑在 session 2 (大屏交互会话, 由 start-players.ps1 经 WMI 拉起, 同 bgm-player)。
# 职责:
#   1. PPT/PPTX 推到 slot1(LED)/slot2(投影) → PowerPoint COM 原生放映到对应屏,
#      动画/切场全保留; 手机翻页条 → 后端 docPage → 本守护 GotoSlide。
#   2. Word DOC/DOCX → Word COM 转 PDF (一次性), 回写路径+页数, kiosk 逐页渲染。
#   3. 打开演示时回写真实总页数 (Slides.Count, 比任何静态解析都准)。
#
# 为什么在 session 2: PowerPoint 放映窗口必须出现在真显示器上; 后端(pm2, 无
# 交互会话) 里 COM 放映起不来 —— 和 bgm-player 的会话逻辑同一条铁律。
# 屏幕坐标: slot1 = 0,0 / slot2 = 1920,0 (与 start-players.ps1 kiosk 摆位一致)。
# =====================================================================
$ErrorActionPreference = 'Continue'
$releaseRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
& (Join-Path $PSScriptRoot 'assert-release-not-held.ps1') -ReleaseProjectRoot $releaseRoot
if (-not $?) { exit 1 }
$api = 'http://127.0.0.1:3200/api'
$logFile = 'D:\smart-control\logs\ppt-player.log'
function Log([string]$m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
}
Log '[ppt] daemon start'
$credentialFile = $env:SMART_CONTROL_PLAYER_TOKEN_FILE
if (-not $credentialFile) { Log '[ppt] missing device credential file'; exit 1 }
function Get-PlayerHeaders {
  $token = [System.IO.File]::ReadAllText($credentialFile).Trim()
  if ($token.Length -lt 32 -or $token.Length -gt 512) { throw 'invalid device credential' }
  return @{ 'X-Player-Token' = $token }
}
function Get-PlayerState([int]$slot) {
  return (Invoke-RestMethod -Uri ($api + '/player-device/' + $slot + '/state') -Headers (Get-PlayerHeaders) -TimeoutSec 5 -ErrorAction Stop).data
}
function Save-DocMeta([int]$slot, [string]$session, [int]$pages, [bool]$pdfReady, [string]$reservationId = '') {
  $data = @{ playbackSession = $session; pdfReady = $pdfReady }
  if ($reservationId) { $data.reservationId = $reservationId }
  if ($pages -gt 0) { $data.pageCount = $pages }
  Invoke-RestMethod -Uri ($api + '/player-device/' + $slot + '/doc-meta') -Headers (Get-PlayerHeaders) -Method Post -ContentType 'application/json' -Body ($data | ConvertTo-Json -Compress) -TimeoutSec 5 -ErrorAction Stop | Out-Null
}

# Win32: 枚举 PowerPoint 放映窗口 (class=screenClass) + 移动/置顶
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class PptWin {
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hgt, bool repaint);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
  public static readonly IntPtr TOPMOST = new IntPtr(-1);
  delegate bool EnumProc(IntPtr h, IntPtr lp);
  public static List<long> FindShowWindows() {
    var found = new List<long>();
    EnumWindows((h, lp) => {
      var sb = new StringBuilder(64);
      GetClassName(h, sb, 64);
      if (sb.ToString() == "screenClass") found.Add(h.ToInt64());
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@

$S = @{ 1 = @{ id = 0; session = ''; pres = $null; hwnd = 0; page = 1; zoom = 100 }; 2 = @{ id = 0; session = ''; pres = $null; hwnd = 0; page = 1; zoom = 100 } }
$slotX = @{ 1 = 0; 2 = 1920 }

# ---- 真实屏幕边界 (2026-07-29 业主: "PPT 页面放大未全屏整页显示") ----
# 根因: 原来放映窗口硬编码 1920×1080, 而投影口 (slot2) 实际输出分辨率可能是
# 1280×720 等 —— 窗口比屏大, 画面被裁掉一圈, 观感就是"放大了没显示全"。
# 修: 按系统枚举的真实显示器边界摆窗; DPI aware 防缩放系数再糊一层。
try { [void][PptWin]::SetProcessDPIAware() } catch { }
[void][System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
function Get-SlotBounds([int]$slot) {
  try {
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $primary = $screens | Where-Object { $_.Primary } | Select-Object -First 1
    if (-not $primary) { $primary = $screens[0] }
    $secondary = $screens | Where-Object { -not $_.Primary } | Select-Object -First 1
    $sc = if ($slot -eq 2 -and $secondary) { $secondary } else { $primary }
    return [pscustomobject]@{ X = $sc.Bounds.X; Y = $sc.Bounds.Y; W = $sc.Bounds.Width; H = $sc.Bounds.Height }
  } catch {
    return [pscustomobject]@{ X = $slotX[$slot]; Y = 0; W = 1920; H = 1080 }   # 枚举失败回退旧摆位
  }
}

# 放映窗口几何 = 目标屏边界 × 缩放% (100=铺满; >100 放大裁边; <100 缩小留边, 居中)
function Apply-Geometry([int]$slot, [int]$zoomPct) {
  $st = $S[$slot]
  if (-not $st.hwnd) { return }
  $b = Get-SlotBounds $slot
  $z = [Math]::Max(50, [Math]::Min(200, $zoomPct))
  $w = [int]($b.W * $z / 100); $h = [int]($b.H * $z / 100)
  $x = [int]($b.X - ($w - $b.W) / 2); $y = [int]($b.Y - ($h - $b.H) / 2)
  [void][PptWin]::MoveWindow([IntPtr]$st.hwnd, $x, $y, $w, $h, $true)
  [void][PptWin]::SetWindowPos([IntPtr]$st.hwnd, [PptWin]::TOPMOST, $x, $y, $w, $h, 0x0040)
  Log ("[ppt] slot" + $slot + " geometry: screen " + $b.W + "x" + $b.H + "@" + $b.X + "," + $b.Y + " zoom=" + $z + "% -> " + $w + "x" + $h + "@" + $x + "," + $y)
}
$pptApp = $null
$convertTried = @{}

function Get-PptApp {
  if ($null -ne $script:pptApp) {
    try { $null = $script:pptApp.Version; return $script:pptApp } catch { $script:pptApp = $null }
  }
  try {
    $script:pptApp = New-Object -ComObject PowerPoint.Application
    Log '[ppt] PowerPoint COM created'
  } catch { Log ("[ppt] PowerPoint COM FAILED: " + $_.Exception.Message) }
  return $script:pptApp
}

function Close-Show([int]$slot) {
  $st = $S[$slot]
  if ($null -ne $st.pres) {
    try { $st.pres.Close() } catch { }
    Log ("[ppt] slot" + $slot + " show closed (media " + $st.id + ")")
  }
  $st.pres = $null; $st.id = 0; $st.session = ''; $st.hwnd = 0; $st.page = 1; $st.zoom = 100
}

function Start-Show([int]$slot, [int]$mediaId, [string]$session, [string]$absPath, [int]$page, [int]$zoom) {
  $app = Get-PptApp
  if ($null -eq $app) { return }
  $before = [PptWin]::FindShowWindows()
  $pres = $null
  try {
    $app.AutomationSecurity = 3
    $pres = $app.Presentations.Open($absPath, $true, $false, $false)
    if ((Get-PlayerState $slot).playbackSession -ne $session) { throw 'playback session changed' }
    $pres.SlideShowSettings.ShowType = 3            # kiosk: 点击不换页, 翻页只听 COM
    $pres.SlideShowSettings.AdvanceMode = 1          # 手动推进
    $pres.SlideShowSettings.LoopUntilStopped = $true
    $null = $pres.SlideShowSettings.Run()
    Start-Sleep -Milliseconds 700
    $after = [PptWin]::FindShowWindows()
    $new = $after | Where-Object { $before -notcontains $_ } | Select-Object -First 1
    if ($new) {
      $S[$slot].hwnd = $new
      Apply-Geometry $slot $zoom      # 按真实屏幕边界铺放 (根治"放大未全屏")
    }
    $S[$slot].pres = $pres; $S[$slot].id = $mediaId; $S[$slot].session = $session; $S[$slot].page = 1; $S[$slot].zoom = $zoom
    $count = 0; try { $count = $pres.Slides.Count } catch { }
    if ($count -gt 0) {
      Save-DocMeta $slot $session $count $false
    }
    if ($page -gt 1) { try { $pres.SlideShowWindow.View.GotoSlide($page); $S[$slot].page = $page } catch { } }
    Log ("[ppt] slot" + $slot + " showing media " + $mediaId + " (" + $count + " slides) hwnd=" + $S[$slot].hwnd)
  } catch {
    if ($pres) { try { $pres.Close() } catch { } }
    Close-Show $slot
    Log ("[ppt] slot" + $slot + " open or authorization failed")
  }
}

function Convert-WordToPdf([int]$slot, [int]$mediaId, [string]$session, [string]$absPath) {
  $ErrorActionPreference = 'Stop'
  if ($convertTried.ContainsKey($session)) { return }
  # One attempt per publish session. On uncertain failure keep the server-side
  # reservation and any output for recovery; do not repeatedly overwrite PDFs.
  $convertTried[$session] = $true
  Log ("[ppt] word2pdf start: media " + $mediaId)
  $word = $null
  $doc = $null
  try {
    $request = @{ playbackSession = $session } | ConvertTo-Json -Compress
    $grant = (Invoke-RestMethod -Uri ($api + '/player-device/' + $slot + '/doc-prepare') -Headers (Get-PlayerHeaders) -Method Post -ContentType 'application/json' -Body $request -TimeoutSec 30 -ErrorAction Stop).data
    if (-not $grant -or [int]$grant.id -ne $mediaId -or [string]$grant.reservationId -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { throw 'invalid document reservation' }
    $maximum = [long]$grant.maxBytes
    if ($maximum -lt 1 -or $maximum -gt 9007199254740991) { throw 'invalid document budget' }
    $source = [System.IO.Path]::GetFullPath([string]$grant.absPath)
    $pdfAbs = [System.IO.Path]::GetFullPath([string]$grant.pdfPath)
    if ($source -ine [System.IO.Path]::GetFullPath($absPath) -or $pdfAbs -ine [System.IO.Path]::ChangeExtension($source, '.pdf')) { throw 'document path changed' }
    if (Test-Path -LiteralPath $pdfAbs -ErrorAction Stop) { throw 'existing PDF requires recovery' }
    $word = New-Object -ComObject Word.Application
    $word.AutomationSecurity = 3
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($source, $false, $true)
    $pages = 0; try { $pages = $doc.ComputeStatistics(2) } catch { }
    $doc.ExportAsFixedFormat($pdfAbs, 17)
    $doc.Close(0)
    $doc = $null
    # Post-write validation, not a hard bound during synchronous COM export.
    # Oversized/uncertain output stays reserved for controlled recovery.
    $pdfFile = Get-Item -LiteralPath $pdfAbs -ErrorAction Stop
    if ($pdfFile.PSIsContainer -or $pdfFile.Length -lt 5 -or $pdfFile.Length -gt $maximum) { throw 'PDF exceeds reservation' }
    Save-DocMeta $slot $session $pages $true ([string]$grant.reservationId)
    Log ("[ppt] word2pdf OK media=" + $mediaId + " pages=" + $pages)
  } catch { Log ('[ppt] word2pdf failed; retain output and reservation for recovery, media=' + $mediaId) }
  finally {
    if ($doc) { try { $doc.Close(0) } catch { } }
    if ($word) { try { $word.Quit() } catch { } }
  }
}

while ($true) {
  Start-Sleep -Milliseconds 1200
  foreach ($slot in 1, 2) {
    try { $ch = Get-PlayerState $slot } catch { Close-Show $slot; continue }
    if ($null -eq $ch) { Close-Show $slot; continue }
    $st = $S[$slot]
    $isDoc = ($ch.currentMediaKind -eq 'doc') -and $ch.currentMediaId
    if (-not $isDoc) {
      if ($st.pres) { Close-Show $slot }
      continue
    }
    $info = $null
    $session = [string]$ch.playbackSession
    try { $info = (Invoke-RestMethod -Uri ($api + '/player-device/' + $slot + '/doc-info?session=' + [Uri]::EscapeDataString($session)) -Headers (Get-PlayerHeaders) -TimeoutSec 5 -ErrorAction Stop).data } catch { Close-Show $slot; continue }
    $chZoom = 100; try { if ($ch.docZoom) { $chZoom = [int]$ch.docZoom } } catch { }
    if ($info.ext -in @('ppt', 'pptx')) {
      if ($st.id -ne $ch.currentMediaId -or $st.session -ne $session) {
        Close-Show $slot
        Start-Show $slot $ch.currentMediaId $session $info.absPath ([int]$ch.docPage) $chZoom
      } else {
        if ($st.pres -and ([int]$ch.docPage) -ne $st.page) {
          try {
            $st.pres.SlideShowWindow.View.GotoSlide([int]$ch.docPage)
            $st.page = [int]$ch.docPage
          } catch { Log ("[ppt] slot" + $slot + " goto FAILED: " + $_.Exception.Message); Close-Show $slot }
        }
        # 缩放/全屏遥控 (2026-07-29): 手机端按钮改 docZoom, 这里跟随重摆窗口
        if ($st.pres -and $chZoom -ne $st.zoom) {
          Apply-Geometry $slot $chZoom
          $st.zoom = $chZoom
        }
      }
    } elseif ($info.ext -in @('doc', 'docx')) {
      if ($st.pres) { Close-Show $slot }
      if (-not $info.docPdfPath) { Convert-WordToPdf $slot $ch.currentMediaId $session $info.absPath }
    }
  }
}
