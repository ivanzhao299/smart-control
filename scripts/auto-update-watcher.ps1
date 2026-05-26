# 现场主控机自动追主分支 (GK9000 等)
# 每次跑: git fetch + 比较 HEAD vs origin/main, 落后就调 update.ps1
#
# 用法 (手动调试):
#   .\scripts\auto-update-watcher.ps1
#   .\scripts\auto-update-watcher.ps1 -DryRun       # 只看, 不更新
#   .\scripts\auto-update-watcher.ps1 -Verbose      # 详细日志
#
# 注册成 Windows 计划任务 (轮询):
#   .\scripts\install-auto-update-task.ps1
#
# 日志: logs\auto-update.log (按日 rotate)
# 锁文件: tmp\auto-update.lock (避免上一次没跑完又触发)

[CmdletBinding()]
param(
  [switch]$DryRun,
  [switch]$Force
)

$ErrorActionPreference = 'Stop'
$projectRoot = Resolve-Path (Join-Path $PSScriptRoot '..')
Set-Location $projectRoot

$logsDir = Join-Path $projectRoot 'logs'
$tmpDir = Join-Path $projectRoot 'tmp'
foreach ($d in @($logsDir, $tmpDir)) {
  if (-not (Test-Path $d)) { New-Item -ItemType Directory -Path $d -Force | Out-Null }
}

$logFile = Join-Path $logsDir ("auto-update-" + (Get-Date -Format 'yyyyMMdd') + ".log")
$lockFile = Join-Path $tmpDir 'auto-update.lock'

function Log($msg, $color = 'Gray') {
  $ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
  $line = "[$ts] $msg"
  Add-Content -Path $logFile -Value $line -Encoding UTF8
  Write-Host $line -ForegroundColor $color
}

# 计划任务跑出来的 PowerShell 有时 PATH 不带 git/node/pnpm, 主动补一遍
$extraPaths = @(
  "$env:ProgramFiles\Git\cmd",
  "$env:ProgramFiles\Git\bin",
  "${env:ProgramFiles(x86)}\Git\cmd",
  "$env:LOCALAPPDATA\Programs\Git\cmd",
  "$env:ProgramFiles\nodejs",
  "$env:APPDATA\npm",
  "$env:LOCALAPPDATA\pnpm"
)
foreach ($p in $extraPaths) {
  if ($p -and (Test-Path $p) -and ($env:PATH -notlike "*$p*")) {
    $env:PATH = "$p;$env:PATH"
  }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Log "git 不在 PATH 也不在标准位置 (Program Files\Git, LocalAppData\Programs\Git). 装一下 Git for Windows 再重试" 'Red'
  exit 2
}

# 锁: 上一次 update 可能还在跑 (build 几十秒), 不要叠加
if (Test-Path $lockFile) {
  $lockAge = (Get-Date) - (Get-Item $lockFile).LastWriteTime
  if ($lockAge.TotalMinutes -lt 15) {
    Log "skip: 上一次更新仍在跑 (锁文件 $([int]$lockAge.TotalSeconds)s 前创建)" 'Yellow'
    exit 0
  }
  Log "warn: 发现 $([int]$lockAge.TotalMinutes) 分钟前的陈旧锁, 清理" 'Yellow'
  Remove-Item $lockFile -Force
}

try {
  # 工作区不干净 → 拒绝 (现场不应有本地改动)
  $dirty = git status --porcelain
  if ($dirty -and -not $Force) {
    Log "skip: 工作区有未提交改动, 跳过 (加 -Force 强制覆盖):" 'Red'
    $dirty | ForEach-Object { Log "  $_" 'Red' }
    exit 0
  }

  # 1) 拉远端最新引用 (不动工作区)
  $fetchOut = git fetch origin main 2>&1
  if ($LASTEXITCODE -ne 0) {
    Log "fetch failed: $fetchOut" 'Red'
    exit 1
  }

  # 2) 比较本地 vs 远端
  $local = (git rev-parse HEAD).Trim()
  $remote = (git rev-parse origin/main).Trim()

  if ($local -eq $remote) {
    # 静默 OK 路径不写文件日志 (太吵), 但 -Verbose 时打到控制台
    Write-Verbose "up-to-date @ $($local.Substring(0,7))"
    exit 0
  }

  $behind = (git rev-list --count "$local..$remote").Trim()
  Log "new commit(s): 本地 $($local.Substring(0,7)) → 远端 $($remote.Substring(0,7)) (落后 $behind 个)" 'Cyan'

  if ($DryRun) {
    Log "dry-run: 不实际调 update.ps1" 'Yellow'
    git log --oneline "$local..$remote" | ForEach-Object { Log "  $_" 'Gray' }
    exit 0
  }

  # 3) 上锁后调 update.ps1
  Set-Content -Path $lockFile -Value (Get-Date -Format 'o')
  Log "running update.ps1..." 'Green'

  $updateScript = Join-Path $projectRoot 'scripts\update.ps1'
  & $updateScript 2>&1 | ForEach-Object {
    Log "  $_" 'DarkGray'
  }

  if ($LASTEXITCODE -ne 0) {
    Log "update.ps1 failed (exit=$LASTEXITCODE)" 'Red'
    exit $LASTEXITCODE
  }

  $after = (git rev-parse HEAD).Trim()
  Log "OK: 已更新到 $($after.Substring(0,7))" 'Green'
} finally {
  if (Test-Path $lockFile) { Remove-Item $lockFile -Force -ErrorAction SilentlyContinue }
}
