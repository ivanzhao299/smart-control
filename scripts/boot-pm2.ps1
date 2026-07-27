# ==============================================================
# Boot bootstrap for pm2 -- replaces start-backend.ps1 / start-frontend.ps1
# (the two "while(true){ node ... }" loops that ran outside pm2).
#
# Why (2026-07-16):
#   The old start-backend.ps1 was a `while($true){ node dist\main.js }` loop that
#   the scheduled task launched at boot, bypassing pm2 entirely. pm2 also managed
#   the same backend (autorestart). Two watchdogs fought over port 3200 and the
#   loser crash-looped on EADDRINUSE -- that was the real cause of "deploy did not
#   take": pm2 restart put new code in pm2's process, but the loop's process (old
#   code) held the port, so new code never came up. start-frontend.ps1 was the
#   same (ran vite directly, outside pm2).
#
#   Decision: pm2 is the single owner of both services. This script does one thing
#   at boot -- resurrect pm2 once from the last `pm2 save` -- with no second watchdog.
#
# Why WMI detach:
#   Windows OpenSSH / scheduled-task sessions kill the spawned process tree on exit.
#   A plain `pm2 resurrect` daemon would die with it, orphaning node (port held but
#   pm2 cannot manage it). Win32_Process.Create detaches the pm2 daemon from this
#   session so it survives.
#
# IMPORTANT: keep this file ASCII-only. PowerShell 5.1 on Chinese Windows reads
# .ps1 as the GBK codepage; a non-ASCII comment in a UTF-8 (no BOM) file eats the
# following newline and merges the next line into the comment -- which silently
# comments out real code. (2026-07-16: cost several rounds to diagnose.)
# ==============================================================
$ErrorActionPreference = 'Continue'
$logDir = 'D:\smart-control\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'boot-pm2.log'
function Log($m) { "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $m" | Out-File -Append -Encoding utf8 $log }

Log '[boot] start'

# Literal absolute paths -- do NOT read $env:APPDATA/$env:USERPROFILE (empty in
# non-interactive sessions). Set PM2_HOME literally so pm2 finds the existing
# daemon instead of spawning an orphan. GK9000 is a fixed single host (user 'user').
$pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }
$PM2HOME = 'C:\Users\user\.pm2'
$env:PM2_HOME = $PM2HOME

# 【2026-07-26 根治守护碎片化】把 PM2_HOME 设成机器级环境变量。
# 根因: WMI Win32_Process.Create 不传调用者环境, 脱离到 session 0 的守护拿不到
# 上面这句 $env:PM2_HOME, 就用了 SYSTEM 默认目录; 而 session-1 的 watcher/update.ps1
# 用 C:\Users\user\.pm2 —— 两边永远对不上, 每次 pm2 调用都新建一个守护, 越堆越多。
# 设成机器级后, 所有进程(含 WMI 脱离的守护、任何会话的 pm2 CLI)都继承同一个
# PM2_HOME, 共用唯一守护, 从源头不再滋生孤儿。幂等: 已一致就跳过。
try {
  $cur = [Environment]::GetEnvironmentVariable('PM2_HOME', 'Machine')
  if ($cur -ne $PM2HOME) {
    [Environment]::SetEnvironmentVariable('PM2_HOME', $PM2HOME, 'Machine')
    Log "[boot] 机器级 PM2_HOME 设为 $PM2HOME (原: $cur)"
  }
} catch { Log "[boot] 设机器级 PM2_HOME 失败 (需管理员?): $($_.Exception.Message)" }

Log "[boot] pm2 = $pm2 ; PM2_HOME = $env:PM2_HOME"

# --- pm2 daemon dedupe (2026-07-27 守护泄漏根治的收尾兜底) ---
# 07-26/27 现场: 空转的 pm2 Daemon.js 以约 5 分钟一个的节奏堆到 128 个。
# 源头 = 本文件下面 resurrect 命令行 (以及 deploy-from-ci.ps1 同款) 里
# `set PM2_HOME=... && pm2` 的 && 前有空格 —— cmd 把 "=" 到 "&&" 之间的所有
# 字符(含那个空格)都算进变量值, PM2_HOME 带了尾随空格; 而 pm2 的 rpc/pub
# 命名管道名是拿 PM2_HOME 逐字拼出来的, 管道名对不上 = 客户端永远"找不到
# 守护 -> 再孵一个"。源头已修 (&& 紧贴值, 见下), 本块只做两件事:
#   1) 一次性清掉已经堆积的百余个空转守护;
#   2) 永久兜底 —— 若将来再有未知机制滋生守护, 每 5 分钟回收一次, 堆不起来。
# 判活规则: 有任何 node 子进程 (pm2 的 app fork 都是 node.exe 且 PPID=守护)
# 的守护绝不动; pm2.pid 里登记的守护绝不动; 其余空转守护满 10 分钟才回收
# (给 部署重启瞬间新孵的守护 留出接管窗口)。
try {
  $nodes = @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction Stop)
  $daemons = @($nodes | Where-Object { $_.CommandLine -match 'pm2\\lib\\Daemon\.js' })
  if ($daemons.Count -gt 1) {
    $parentPids = @($nodes | ForEach-Object { $_.ParentProcessId } | Sort-Object -Unique)
    $canonPid = 0
    try {
      $pidFile = Join-Path $PM2HOME 'pm2.pid'
      if (Test-Path $pidFile) { $canonPid = [int]((Get-Content $pidFile -ErrorAction Stop | Select-Object -First 1).Trim()) }
    } catch { }
    $now = Get-Date
    $killed = 0
    foreach ($d in $daemons) {
      if ($parentPids -contains $d.ProcessId) { continue }
      if ($canonPid -gt 0 -and $d.ProcessId -eq $canonPid) { continue }
      $ageMin = 99999
      try { if ($d.CreationDate) { $ageMin = ($now - $d.CreationDate).TotalMinutes } } catch { }
      if ($ageMin -lt 10) { continue }
      Stop-Process -Id $d.ProcessId -Force -ErrorAction SilentlyContinue
      $killed++
    }
    Log "[boot] daemon dedupe: total=$($daemons.Count) canonPid=$canonPid killed=$killed"
  }
} catch { Log "[boot] daemon dedupe failed: $($_.Exception.Message)" }

# --- WireGuard keepalive (must stay ABOVE the early-exit below) ---
# GK9000 sits behind NAT. With no keepalive the NAT mapping expires after a few idle
# minutes and the jump host can no longer INITIATE a connection -- deploys time out and
# remote access dies -- even though the machine is online and its own outbound traffic
# (git fetch, heartbeat) works fine. That asymmetry is what made the tunnel look
# "sometimes up, sometimes down" for two days (2026-07-19/20) and cost several failed
# deploys before the cause was found.
#
# 25s is the WireGuard-recommended interval. `wg set` is a RUNTIME-only change: it does
# not survive a tunnel or host restart -- and this host gets powered off by hand fairly
# often. So re-apply it on every run: this script fires at boot AND on the 5-minute
# backstop trigger, and the call is idempotent.
#
# Deliberately placed before the "ports already listening -> exit 0" shortcut, otherwise
# the keepalive would be skipped exactly when the services are healthy (the common case).
$wgExe = 'C:\Program Files\WireGuard\wg.exe'
$wgPeer = 'pFHcSLdoGn19NXM64W2k0k+4XYu3SFBpzTAv8XtBliw='
if (Test-Path $wgExe) {
  try {
    & $wgExe set gk9000 peer $wgPeer persistent-keepalive 25 2>&1 | Out-Null
    Log '[boot] wireguard persistent-keepalive=25 applied'
  } catch {
    Log "[boot] wireguard keepalive failed: $($_.Exception.Message)"
  }
} else {
  Log '[boot] wg.exe not found, skip keepalive'
}

# Ports already listening = services already up (started manually / left running).
# Skip resurrect so we don't stack a second layer.
$backendUp = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$frontendUp = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
# 2026-07-27: 每次都把端口判定落日志 —— 排查"5 分钟一个守护"时最需要的就是
# 这条证据 (到底是早退了还是走到了 resurrect), 之前只在早退分支才有日志。
Log "[boot] port check: backend(3200)=$backendUp frontend(5173)=$frontendUp"
if ($backendUp -and $frontendUp) {
  Log '[boot] 3200 + 5173 already listening, skip resurrect'
  exit 0
}

# Run pm2 resurrect detached from this session (survives session exit).
# 关键: 命令里显式 set PM2_HOME 再跑 pm2 —— WMI 不传环境, 不注入的话这个脱离守护
# 会落到 SYSTEM 默认目录, 与 session-1 调用者的 C:\Users\user\.pm2 对不上 (碎片化根因)。
# 2026-07-27 修复: && 必须紧贴变量值, 不能有空格。cmd 把 "=" 到 "&&" 之间的
# 所有字符都算进值里 —— 原来的 `set PM2_HOME=... && pm2` 让 PM2_HOME 带上了
# 尾随空格, pm2 的 rpc/pub 命名管道名由 PM2_HOME 逐字拼出 (管道路径不走文件
# 系统归一化, 尾随空格不会被吞), 于是这个守护活在一个别的客户端永远算不出的
# 管道名上, 后续每次 pm2 调用都"找不到守护 -> 又孵一个" —— 守护堆积的源头。
$cmd = "cmd /c `"set PM2_HOME=$PM2HOME&& $pm2 resurrect`""
try {
  $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\user', $null)
  Log "[boot] WMI resurrect started, ProcessId=$($r.ProcessId) ReturnValue=$($r.ReturnValue)"
} catch {
  Log "[boot] WMI resurrect failed: $($_.Exception.Message)"
}

# Give services time to come up, then a simple confirm (verify-deploy.js is authoritative).
Start-Sleep -Seconds 12
$b = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$f = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
Log "[boot] result: backend(3200)=$b frontend(5173)=$f"
Log '[boot] done'
