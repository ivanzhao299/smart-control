# =====================================================================
# GK9000 三路播控 Kiosk 启动脚本
# 文件: scripts/start-players.ps1
#
# 拉起 Chromium 窗口加载 PlayerPage:
#   - 主屏 (HDMI1 → V2460 → LED 大屏): ?slot=1   全屏 kiosk
#   - 副屏 (HDMI2 → 投影仪): ?slot=2             全屏 kiosk
#   - 背景音乐 (声卡 → EKX 音响输入): ?slot=3    小窗 (只为出声, 不占屏)
#
# 用法:
#   .\scripts\start-players.ps1            # 启动三路
#   .\scripts\start-players.ps1 -Stop      # 杀掉已启动的 player 窗口
#   .\scripts\start-players.ps1 -Slot 1    # 只启动 slot=1
#   .\scripts\start-players.ps1 -Slot 3    # 只启动音频播放器
#
# 多屏坐标要根据 Windows 显示设置实测填:
#   Win + P 看排列, 显示设置 (Win+R "ms-settings:display") 看每个屏的"分辨率 + 起点 X"
#
# 当前默认假设 (现场实际接线后再调):
#   显示器 1 (主, HDMI1): 0,0 . 1920x1080
#   显示器 2 (副, HDMI2): 1920,0 . 1920x1080
#
# 改这里的两个坐标对应实际现场即可, 不动其他逻辑.
# =====================================================================
[CmdletBinding()]
param(
  [switch]$Stop,
  [int]$Slot = 0,        # 0 = 两路都启动
  [string]$BaseUrl = 'http://localhost:5173/control/player',
  [int]$Slot1X = 0,
  [int]$Slot1Y = 0,
  [int]$Slot2X = 1920,
  [int]$Slot2Y = 0,
  [int]$ScreenW = 1920,
  [int]$ScreenH = 1080
)

$ErrorActionPreference = 'Continue'

# 1) 找 Chromium / Edge (优先 Chrome → Edge → 报错)
function Find-Browser {
  $candidates = @(
    "${env:ProgramFiles}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
    "${env:ProgramFiles}\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
  )
  foreach ($p in $candidates) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return $null
}

# 2) 杀已有 player 窗口 (按 user-data-dir 标记区分)
function Stop-Players {
  Write-Host '正在停止已有 player 窗口...' -ForegroundColor Yellow
  $patterns = @('player-slot1', 'player-slot2', 'player-slot3')
  foreach ($pat in $patterns) {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $pat } |
      ForEach-Object {
        Write-Host "  杀 PID $($_.ProcessId) ($pat)" -ForegroundColor Gray
        Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
      }
  }
}

if ($Stop) { Stop-Players; exit 0 }

$browser = Find-Browser
if (-not $browser) {
  Write-Host '❌ 没找到 Chrome / Edge. 装一个再跑.' -ForegroundColor Red
  exit 1
}
Write-Host "→ 浏览器: $browser" -ForegroundColor Green

# 3) 先杀掉旧 player (避免重复启动)
Stop-Players
Start-Sleep -Seconds 1

# 4) 启动指定 slot
function Start-Slot {
  param([int]$N, [int]$X, [int]$Y, [int]$W, [int]$H)
  $dataDir = "$env:LOCALAPPDATA\smart-control-player-slot$N"
  $url = "${BaseUrl}?slot=$N"
  $args = @(
    '--kiosk', $url,
    "--user-data-dir=$dataDir",
    "--window-position=$X,$Y",
    "--window-size=$W,$H",
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-features=TranslateUI,AutofillServerCommunication',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-pinch',
    '--disable-restore-session-state'
  )
  Write-Host "→ 启动 slot=$N @ $url (位置 $X,$Y, 数据目录 $dataDir)" -ForegroundColor Cyan
  # ⚠️ 必须 Normal 不能 Hidden: Chrome 会无视 Hidden 强制全屏, 但 Edge 会真的把窗口藏起来
  # (现场用 Edge), 导致播放器进程在跑、大屏却只显示桌面. --kiosk 自己会全屏.
  Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Normal
}

# 音频播放器 (slot=3): 不全屏, 小窗 (只为让 Chromium 出声到声卡 → EKX).
# 关键: 不能 minimize (后台节流会卡音频), 用小窗 + 防节流 flag 保活.
function Start-AudioSlot {
  $N = 3
  $dataDir = "$env:LOCALAPPDATA\smart-control-player-slot$N"
  $url = "${BaseUrl}?slot=$N"
  $args = @(
    '--app=' + $url,                       # app 模式: 无地址栏的独立小窗
    "--user-data-dir=$dataDir",
    '--window-position=40,40',
    '--window-size=480,320',
    '--no-first-run',
    '--no-default-browser-check',
    '--autoplay-policy=no-user-gesture-required',   # 自动出声 (背景音乐)
    '--disable-background-timer-throttling',         # 防后台节流卡音频
    '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows',
    '--disable-restore-session-state'
  )
  Write-Host "→ 启动 slot=3 音频播放器 @ $url (小窗 480x320, 声卡→EKX)" -ForegroundColor Magenta
  Start-Process -FilePath $browser -ArgumentList $args -WindowStyle Minimized
}

if ($Slot -eq 0 -or $Slot -eq 1) {
  Start-Slot -N 1 -X $Slot1X -Y $Slot1Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 2) {
  Start-Sleep -Milliseconds 500
  Start-Slot -N 2 -X $Slot2X -Y $Slot2Y -W $ScreenW -H $ScreenH
}
if ($Slot -eq 0 -or $Slot -eq 3) {
  Start-Sleep -Milliseconds 500
  Start-AudioSlot
}

Write-Host ''
Write-Host '✓ Player kiosk 已启动. 状态:' -ForegroundColor Green
Start-Sleep -Seconds 2
Get-CimInstance Win32_Process -Filter "Name='chrome.exe' OR Name='msedge.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -match 'smart-control-player-slot' } |
  ForEach-Object {
    if ($_.CommandLine -match 'slot1') { Write-Host "  slot=1 (LED)   PID $($_.ProcessId)" -ForegroundColor Green }
    if ($_.CommandLine -match 'slot2') { Write-Host "  slot=2 (投影)  PID $($_.ProcessId)" -ForegroundColor Green }
    if ($_.CommandLine -match 'slot3') { Write-Host "  slot=3 (音频)  PID $($_.ProcessId)" -ForegroundColor Magenta }
  }
Write-Host ''
Write-Host '停止: .\scripts\start-players.ps1 -Stop' -ForegroundColor Gray
