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
$api = 'http://127.0.0.1:3200/api'
$logFile = 'D:\smart-control\logs\ppt-player.log'
function Log([string]$m) {
  $line = (Get-Date -Format 'yyyy-MM-dd HH:mm:ss') + ' ' + $m
  try { Add-Content -Path $logFile -Value $line -Encoding UTF8 } catch { }
}
Log '[ppt] daemon start'

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

$S = @{ 1 = @{ id = 0; pres = $null; hwnd = 0; page = 1 }; 2 = @{ id = 0; pres = $null; hwnd = 0; page = 1 } }
$slotX = @{ 1 = 0; 2 = 1920 }
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
  $st.pres = $null; $st.id = 0; $st.hwnd = 0; $st.page = 1
}

function Start-Show([int]$slot, [int]$mediaId, [string]$absPath, [int]$page) {
  $app = Get-PptApp
  if ($null -eq $app) { return }
  $before = [PptWin]::FindShowWindows()
  try {
    $pres = $app.Presentations.Open($absPath, $true, $false, $false)
    $pres.SlideShowSettings.ShowType = 3            # kiosk: 点击不换页, 翻页只听 COM
    $pres.SlideShowSettings.AdvanceMode = 1          # 手动推进
    $pres.SlideShowSettings.LoopUntilStopped = $true
    $null = $pres.SlideShowSettings.Run()
    Start-Sleep -Milliseconds 700
    $after = [PptWin]::FindShowWindows()
    $new = $after | Where-Object { $before -notcontains $_ } | Select-Object -First 1
    if ($new) {
      [void][PptWin]::MoveWindow([IntPtr]$new, $slotX[$slot], 0, 1920, 1080, $true)
      [void][PptWin]::SetWindowPos([IntPtr]$new, [PptWin]::TOPMOST, $slotX[$slot], 0, 1920, 1080, 0x0040)
      $S[$slot].hwnd = $new
    }
    $S[$slot].pres = $pres; $S[$slot].id = $mediaId; $S[$slot].page = 1
    $count = 0; try { $count = $pres.Slides.Count } catch { }
    if ($count -gt 0) {
      try { Invoke-RestMethod -Uri ($api + '/media/' + $mediaId + '/doc-meta') -Method Post -ContentType 'application/json' -Body ('{"pageCount":' + $count + '}') | Out-Null } catch { }
    }
    if ($page -gt 1) { try { $pres.SlideShowWindow.View.GotoSlide($page); $S[$slot].page = $page } catch { } }
    Log ("[ppt] slot" + $slot + " showing media " + $mediaId + " (" + $count + " slides) hwnd=" + $S[$slot].hwnd)
  } catch { Log ("[ppt] slot" + $slot + " open FAILED: " + $_.Exception.Message) }
}

function Convert-WordToPdf([int]$mediaId, [string]$absPath) {
  if ($convertTried.ContainsKey([string]$mediaId)) { return }
  $convertTried[[string]$mediaId] = $true
  Log ("[ppt] word2pdf start: media " + $mediaId)
  $word = $null
  try {
    $pdfAbs = [System.IO.Path]::ChangeExtension($absPath, '.pdf')
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $doc = $word.Documents.Open($absPath, $false, $true)
    $pages = 0; try { $pages = $doc.ComputeStatistics(2) } catch { }
    $doc.ExportAsFixedFormat($pdfAbs, 17)
    $doc.Close(0)
    $rel = [System.IO.Path]::GetFileName((Split-Path $absPath -Parent)) + '/' + [System.IO.Path]::GetFileName($pdfAbs)
    $body = '{"pdfRelPath":"' + $rel + '"' + $(if ($pages -gt 0) { ',"pageCount":' + $pages } else { '' }) + '}'
    Invoke-RestMethod -Uri ($api + '/media/' + $mediaId + '/doc-meta') -Method Post -ContentType 'application/json' -Body $body | Out-Null
    Log ("[ppt] word2pdf OK: " + $rel + " pages=" + $pages)
  } catch { Log ("[ppt] word2pdf FAILED: " + $_.Exception.Message) }
  finally { if ($word) { try { $word.Quit() } catch { } } }
}

while ($true) {
  Start-Sleep -Milliseconds 1200
  $chs = $null
  try { $chs = (Invoke-RestMethod -Uri ($api + '/playback/channels') -TimeoutSec 4).data } catch { continue }
  foreach ($slot in 1, 2) {
    $ch = $chs | Where-Object { $_.slot -eq $slot }
    if ($null -eq $ch) { continue }
    $st = $S[$slot]
    $isDoc = ($ch.currentMediaKind -eq 'doc') -and $ch.currentMediaId
    if (-not $isDoc) {
      if ($st.pres) { Close-Show $slot }
      continue
    }
    $info = $null
    try { $info = (Invoke-RestMethod -Uri ($api + '/media/' + $ch.currentMediaId + '/doc-info') -TimeoutSec 4).data } catch { continue }
    if ($info.ext -in @('ppt', 'pptx')) {
      if ($st.id -ne $ch.currentMediaId) {
        Close-Show $slot
        Start-Show $slot $ch.currentMediaId $info.absPath ([int]$ch.docPage)
      } elseif ($st.pres -and ([int]$ch.docPage) -ne $st.page) {
        try {
          $st.pres.SlideShowWindow.View.GotoSlide([int]$ch.docPage)
          $st.page = [int]$ch.docPage
        } catch { Log ("[ppt] slot" + $slot + " goto FAILED: " + $_.Exception.Message); Close-Show $slot }
      }
    } elseif ($info.ext -in @('doc', 'docx')) {
      if ($st.pres) { Close-Show $slot }
      if (-not $info.docPdfPath) { Convert-WordToPdf $ch.currentMediaId $info.absPath }
    }
  }
}
