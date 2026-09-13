# =====================================================================
# 展贸中心智能化中控系统 - Windows 健康检测脚本
# 文件: deploy\scripts\health.ps1
# 检测项 (Sprint-10 Task-13):
#   1) PM2 进程
#   2) Node 后端 (loopback:3000 + /api/system/health)
#   3) SQLite 文件
#   4) WebSocket (/ws/status)
#   5) Nginx 进程 + :80
#   6) 网络出站 (设备网段连通性)
# 用法:
#   deploy\scripts\health.ps1                # 默认全部检测
#   deploy\scripts\health.ps1 -PingTargets '192.168.50.20,192.168.50.30'
#   deploy\scripts\health.ps1 -Json          # 输出 JSON (供监控集成)
# 退出码:
#   0  全部 OK
#   1  关键项异常 (PM2 / Node / SQLite / Nginx)
#   2  仅非关键项异常 (网络 / WebSocket)
# =====================================================================
[CmdletBinding()]
param(
  [string]$BackendUrl = 'http://127.0.0.1:3000',
  [string]$NginxUrl   = 'http://127.0.0.1/healthz',
  [string]$DbPath     = '',
  [string]$PingTargets = '',
  [switch]$Json
)

$ErrorActionPreference = 'Continue'
$results = New-Object System.Collections.Generic.List[object]
$criticalBad = 0
$nonCriticalBad = 0

function Add-Result {
  param([string]$Name, [bool]$Ok, [string]$Detail, [bool]$Critical = $true)
  $results.Add([pscustomobject]@{
    name = $Name
    ok = $Ok
    critical = $Critical
    detail = $Detail
    at = (Get-Date).ToString('s')
  })
  if (-not $Ok) {
    if ($Critical) { $script:criticalBad++ } else { $script:nonCriticalBad++ }
  }
}

# 1) PM2
try {
  $pm2 = & pm2 jlist 2>$null | ConvertFrom-Json
  $proc = $pm2 | Where-Object { $_.name -eq 'smart-control-backend' } | Select-Object -First 1
  if ($null -ne $proc -and $proc.pm2_env.status -eq 'online') {
    Add-Result -Name 'pm2' -Ok $true -Detail ("pid={0} restarts={1} uptime={2}s" -f $proc.pid, $proc.pm2_env.restart_time, [int](((Get-Date).ToUniversalTime() - [datetime]'1970-01-01').TotalSeconds - $proc.pm2_env.pm_uptime/1000))
  } else {
    Add-Result -Name 'pm2' -Ok $false -Detail "smart-control-backend 未在 PM2 中 online"
  }
} catch {
  Add-Result -Name 'pm2' -Ok $false -Detail "PM2 不可用或未安装: $($_.Exception.Message)"
}

# 2) Node 后端 (HTTP)
try {
  $sw = [Diagnostics.Stopwatch]::StartNew()
  $resp = Invoke-RestMethod -Uri "$BackendUrl/api/system/health" -Method Get -TimeoutSec 5
  $sw.Stop()
  $h = $resp.data
  $ok = ($null -ne $h -and $h.apiStatus -eq 'up')
  Add-Result -Name 'node-backend' -Ok $ok -Detail ("api={0} db={1} ws={2} sched={3} cpu={4}% mem={5}% latency={6}ms" -f `
    $h.apiStatus, $h.databaseStatus, $h.websocketStatus, $h.schedulerStatus, $h.cpuUsagePercent, $h.memoryUsagePercent, $sw.ElapsedMilliseconds)
} catch {
  Add-Result -Name 'node-backend' -Ok $false -Detail "GET /api/system/health 失败: $($_.Exception.Message)"
}

# 3) SQLite 文件
if ([string]::IsNullOrWhiteSpace($DbPath)) {
  if ($env:DB_PATH) {
    $DbPath = $env:DB_PATH
  } else {
    $DbPath = 'D:\smart-control\database\smart-control.db'
  }
}
if (Test-Path $DbPath) {
  $st = Get-Item $DbPath
  $sizeMB = [math]::Round($st.Length / 1MB, 2)
  Add-Result -Name 'sqlite-file' -Ok $true -Detail "path=$DbPath size=${sizeMB}MB mtime=$($st.LastWriteTime.ToString('s'))"
} else {
  Add-Result -Name 'sqlite-file' -Ok $false -Detail "数据库文件不存在: $DbPath"
}

# 4) WebSocket
try {
  $uriBuilder = [System.UriBuilder]::new($BackendUrl)
  $uriBuilder.Scheme = if ($uriBuilder.Scheme -eq 'https') { 'wss' } else { 'ws' }
  $uriBuilder.Path = '/ws/status'
  $wsUri = $uriBuilder.Uri
  $ws = [System.Net.WebSockets.ClientWebSocket]::new()
  $cts = [System.Threading.CancellationTokenSource]::new(3000)
  $task = $ws.ConnectAsync($wsUri, $cts.Token)
  $task.Wait()
  if ($ws.State -eq 'Open') {
    Add-Result -Name 'websocket' -Ok $true -Detail "$wsUri connected" -Critical $false
    $ws.CloseAsync([System.Net.WebSockets.WebSocketCloseStatus]::NormalClosure, 'bye', [Threading.CancellationToken]::None).Wait()
  } else {
    Add-Result -Name 'websocket' -Ok $false -Detail "state=$($ws.State)" -Critical $false
  }
} catch {
  Add-Result -Name 'websocket' -Ok $false -Detail "WS 连接失败: $($_.Exception.Message)" -Critical $false
}

# 5) Nginx
$nginxProc = Get-Process -Name nginx -ErrorAction SilentlyContinue
if ($nginxProc) {
  try {
    $r = Invoke-WebRequest -Uri $NginxUrl -Method Get -TimeoutSec 5 -UseBasicParsing
    if ($r.StatusCode -eq 200) {
      Add-Result -Name 'nginx' -Ok $true -Detail "processes=$($nginxProc.Count) /healthz=200"
    } else {
      Add-Result -Name 'nginx' -Ok $false -Detail "/healthz 状态码=$($r.StatusCode)"
    }
  } catch {
    Add-Result -Name 'nginx' -Ok $false -Detail "nginx 已启动但 /healthz 不可达: $($_.Exception.Message)"
  }
} else {
  Add-Result -Name 'nginx' -Ok $false -Detail "未找到 nginx 进程 (Get-Process nginx)"
}

# 6) 网络出站 (设备网段) - 非关键
if ([string]::IsNullOrWhiteSpace($PingTargets)) {
  $PingTargets = $env:HEALTH_PING_TARGETS
}
if (-not [string]::IsNullOrWhiteSpace($PingTargets)) {
  foreach ($t in $PingTargets.Split(',')) {
    $ip = $t.Trim()
    if (-not $ip) { continue }
    $ok = Test-Connection -ComputerName $ip -Count 1 -Quiet -TimeoutSeconds 2
    Add-Result -Name "ping:$ip" -Ok $ok -Detail (if ($ok) { 'reachable' } else { 'unreachable' }) -Critical $false
  }
} else {
  Add-Result -Name 'ping' -Ok $true -Detail '未配置 PingTargets, 跳过' -Critical $false
}

# 汇总
if ($Json) {
  $payload = [pscustomobject]@{
    timestamp = (Get-Date).ToString('o')
    host = $env:COMPUTERNAME
    ok = ($criticalBad -eq 0 -and $nonCriticalBad -eq 0)
    criticalFailures = $criticalBad
    nonCriticalFailures = $nonCriticalBad
    checks = $results
  }
  $payload | ConvertTo-Json -Depth 6
} else {
  Write-Host "================================================" -ForegroundColor Cyan
  Write-Host " 健康检测 — $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')" -ForegroundColor Cyan
  Write-Host "================================================" -ForegroundColor Cyan
  foreach ($r in $results) {
    $tag = if ($r.ok) { ' OK ' } else { 'FAIL' }
    $color = if ($r.ok) { 'Green' } elseif ($r.critical) { 'Red' } else { 'Yellow' }
    Write-Host (" [{0}] {1,-16} {2}" -f $tag, $r.name, $r.detail) -ForegroundColor $color
  }
  Write-Host ""
  Write-Host (" critical failures: {0}    non-critical: {1}" -f $criticalBad, $nonCriticalBad) -ForegroundColor Cyan
}

if ($criticalBad -gt 0) { exit 1 }
if ($nonCriticalBad -gt 0) { exit 2 }
exit 0
