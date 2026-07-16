# ==============================================================
# 开机引导 pm2 — 取代 start-backend.ps1 / start-frontend.ps1 那两个直跑 node 的死循环
#
# 为什么换掉旧脚本 (2026-07-16):
#   旧的 start-backend.ps1 是 `while($true){ node dist\main.js }` 死循环, 计划任务
#   开机拉起它。可 pm2 也在管同一个后端 (autorestart)。两个看门狗抢 3200 端口,
#   输的那个无限 EADDRINUSE 崩溃循环 —— 这就是"部署后没跑通"的根因: pm2 restart
#   把新代码放进 pm2 的进程, 但端口被死循环那份 (旧代码) 占着, 新代码永远起不来。
#   start-frontend.ps1 同理 (直跑 vite, 绕开 pm2)。
#
#   决策: 后端/前端都只由 pm2 管。这个脚本开机只做一件事 —— resurrect 一次 pm2,
#   把上次 `pm2 save` 存下的进程列表拉起来。不再有第二个看门狗。
#
# 为什么 WMI 脱离:
#   Windows OpenSSH / 计划任务会话结束时会杀掉派生的进程树。直接
#   `pm2 resurrect` 起的 daemon 会随之死掉, node 变孤儿 (端口占着但 pm2 管不到)。
#   用 WMI Win32_Process.Create 让 pm2 daemon 脱离本会话, 独立存活。
# ==============================================================
$ErrorActionPreference = 'Continue'
$logDir = 'D:\smart-control\logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$log = Join-Path $logDir 'boot-pm2.log'
function Log($m) { "$((Get-Date).ToString('yyyy-MM-dd HH:mm:ss')) $m" | Out-File -Append -Encoding utf8 $log }

Log '[boot] start'

# pm2 / PM2_HOME 用字面绝对路径, 不碰 env —— 非交互会话里 APPDATA/USERPROFILE
# 都可能为空 (见 deploy-from-ci.ps1 的说明)。GK9000 固定单机 (user 'user')。
$pm2 = 'C:\Users\user\AppData\Roaming\npm\pm2.cmd'
if (-not (Test-Path $pm2)) { $pm2 = 'pm2' }  # 退回 PATH
$env:PM2_HOME = 'C:\Users\user\.pm2'
Log "[boot] pm2 = $pm2 ; PM2_HOME = $env:PM2_HOME"

# 端口已经有人监听 = 服务已在跑 (人工起过 / 上一次没退干净), 别再 resurrect 叠一层
$backendUp = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$frontendUp = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
if ($backendUp -and $frontendUp) {
  Log '[boot] 3200 + 5173 都已在监听, 跳过 resurrect'
  exit 0
}

# WMI 脱离本会话跑 pm2 resurrect (会话结束不杀它)
$cmd = "cmd /c `"$pm2`" resurrect"
try {
  $r = ([wmiclass]'\\.\root\cimv2:Win32_Process').Create($cmd, 'C:\Users\user', $null)
  Log "[boot] WMI resurrect 已发起, ProcessId=$($r.ProcessId) ReturnValue=$($r.ReturnValue)"
} catch {
  Log "[boot] WMI resurrect 失败: $($_.Exception.Message)"
}

# 等服务起来, 简单确认 (真正的验证交给 verify-deploy.js)
Start-Sleep -Seconds 12
$b = $null -ne (Get-NetTCPConnection -LocalPort 3200 -State Listen -ErrorAction SilentlyContinue)
$f = $null -ne (Get-NetTCPConnection -LocalPort 5173 -State Listen -ErrorAction SilentlyContinue)
Log "[boot] 结果: backend(3200)=$b frontend(5173)=$f"
Log '[boot] done'
