# =====================================================================
# 展贸中心智能化中控系统 - 开机自启脚本
# 由 Windows 任务计划程序 (AtStartup, RunAs SYSTEM) 调用
# 文件: deploy\windows-startup\boot.ps1
# =====================================================================
$ErrorActionPreference = 'Continue'
$logDir = 'D:\smart-control\logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$logFile = Join-Path $logDir 'boot.log'
function Log { param([string]$m) "[$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')] $m" | Out-File -FilePath $logFile -Append -Encoding utf8 }

Log "boot.ps1 启动"

# 1. PM2: 优先 resurrect, 失败则按 ecosystem 启动
try {
  $out = & pm2 resurrect 2>&1
  Log "pm2 resurrect: $out"
} catch {
  Log "pm2 resurrect 失败: $($_.Exception.Message), 改用 ecosystem"
  try {
    $out = & pm2 start 'D:\smart-control\deploy\ecosystem.config.js' --env production 2>&1
    Log "pm2 start ecosystem: $out"
  } catch {
    Log "PM2 启动失败: $($_.Exception.Message)"
  }
}

# 2. Nginx: 若存在且未运行则启动
$nginx = 'C:\nginx\nginx.exe'
if (Test-Path $nginx) {
  if (-not (Get-Process -Name nginx -ErrorAction SilentlyContinue)) {
    try {
      Start-Process -FilePath $nginx -WorkingDirectory 'C:\nginx' -WindowStyle Hidden
      Log "nginx 已启动"
    } catch {
      Log "nginx 启动失败: $($_.Exception.Message)"
    }
  } else {
    Log "nginx 已在运行, 跳过"
  }
} else {
  Log "未找到 C:\nginx\nginx.exe, 跳过 nginx 拉起"
}

Log "boot.ps1 完成"
