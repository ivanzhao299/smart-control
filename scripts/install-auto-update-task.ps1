# 注册 Windows 计划任务: 每 90 秒检查一次 main, 有新 commit 就自动 update
# 在 GK9000 RDP 进去后 *管理员 PowerShell* 跑一次, 之后永远自治
#
# 用法:
#   .\scripts\install-auto-update-task.ps1                  # 装/更新
#   .\scripts\install-auto-update-task.ps1 -IntervalSec 60  # 自定义间隔 (默认 90s)
#   .\scripts\install-auto-update-task.ps1 -Uninstall       # 卸载
#
# 注意:
#   - 用当前登录用户跑 (不是 SYSTEM), 这样 git 凭据 / SSH key 走用户目录
#   - 任务名: SmartControl-AutoUpdate
#   - 失败不影响系统, 日志看 logs\auto-update-YYYYMMDD.log

[CmdletBinding()]
param(
  [int]$IntervalSec = 90,
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$taskName = 'SmartControl-AutoUpdate'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
$watcher = Join-Path $projectRoot 'scripts\auto-update-watcher.ps1'

# 必须管理员
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
  Write-Host "需要管理员权限. 请右键 PowerShell 选 '以管理员身份运行' 后重试" -ForegroundColor Red
  exit 1
}

if ($Uninstall) {
  if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
    Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
    Write-Host "已卸载计划任务: $taskName" -ForegroundColor Green
  } else {
    Write-Host "计划任务不存在: $taskName" -ForegroundColor Yellow
  }
  exit 0
}

if (-not (Test-Path $watcher)) {
  Write-Host "找不到 watcher 脚本: $watcher" -ForegroundColor Red
  exit 1
}

# 已存在就先卸了再装 (方便更新参数)
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  Write-Host "已存在同名任务, 先卸载..." -ForegroundColor Yellow
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}

$action = New-ScheduledTaskAction `
  -Execute 'powershell.exe' `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$watcher`"" `
  -WorkingDirectory $projectRoot

# Trigger: 30s 后开始, 之后每 N 秒一次, 持续 10 年
# (不用 AtLogOn — 已登录用户装任务时 AtLogOn 不会立即触发, 用户得登出再登才生效)
$trigger = New-ScheduledTaskTrigger `
  -Once -At (Get-Date).AddSeconds(30) `
  -RepetitionInterval (New-TimeSpan -Seconds $IntervalSec) `
  -RepetitionDuration ([TimeSpan]::FromDays(365 * 10))

# 用当前登录用户身份, 而非 SYSTEM (git 凭据要从用户家目录读)
$principal = New-ScheduledTaskPrincipal `
  -UserId $env:USERNAME `
  -LogonType Interactive `
  -RunLevel Limited

$settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -StartWhenAvailable `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Minutes 10)

Register-ScheduledTask `
  -TaskName $taskName `
  -Action $action `
  -Trigger $trigger `
  -Principal $principal `
  -Settings $settings `
  -Description "smart-control: 每 ${IntervalSec}s 检查 main, 有新 commit 就自动 update" | Out-Null

Write-Host "" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host " 计划任务已注册: $taskName" -ForegroundColor Green
Write-Host "================================================" -ForegroundColor Green
Write-Host " 间隔     : 每 ${IntervalSec} 秒"
Write-Host " 执行身份 : $env:USERNAME (Interactive)"
Write-Host " Watcher  : $watcher"
Write-Host " 工作目录 : $projectRoot"
Write-Host " 日志     : $projectRoot\logs\auto-update-YYYYMMDD.log"
Write-Host ""
Write-Host "查看下次运行:    Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo" -ForegroundColor Gray
Write-Host "立即跑一次:      Start-ScheduledTask -TaskName $taskName" -ForegroundColor Gray
Write-Host "卸载:            .\scripts\install-auto-update-task.ps1 -Uninstall" -ForegroundColor Gray
Write-Host ""

# 立即跑一次验证
Write-Host "正在立即触发一次以验证..." -ForegroundColor Cyan
Start-ScheduledTask -TaskName $taskName
Start-Sleep -Seconds 3
$info = Get-ScheduledTask -TaskName $taskName | Get-ScheduledTaskInfo
Write-Host "  上次运行 : $($info.LastRunTime)"
Write-Host "  上次结果 : 0x$('{0:X}' -f $info.LastTaskResult) ($(if($info.LastTaskResult -eq 0){'OK'}else{'见日志'}))"
Write-Host "  下次运行 : $($info.NextRunTime)"
