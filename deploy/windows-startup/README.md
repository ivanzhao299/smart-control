# Windows 10 开机自启配置

目标：中控主机 `GIADA GK9000` 上电后 PM2 自动恢复进程，Nginx 自动监听 80 端口。

提供两套独立方案，**任选其一**：

| 方案 | 适用 | 复杂度 | 推荐度 |
| --- | --- | --- | --- |
| **A. PM2 Windows Startup** | 仅守护 Node 后端 | ⭐ | ★★★★★ |
| **B. Windows 任务计划程序** | PM2 + Nginx 一起拉起，或当 A 方案因 Windows Service 权限受限时备用 | ⭐⭐ | ★★★★ |

---

## 方案 A — PM2 Windows Startup（推荐）

PM2 官方的 Windows Service 包，把 `pm2 resurrect` 注册为系统服务，开机时自动恢复 `pm2 save` 后的进程列表。

### 步骤（PowerShell 以管理员运行）

```powershell
# 1. 全局安装
npm i -g pm2 pm2-windows-startup

# 2. 安装服务 (注册为 Windows Service: pm2.exe)
pm2-startup install

# 3. 第一次启动你的进程并保存
pm2 start D:\smart-control\deploy\ecosystem.config.js --env production
pm2 save                # 写到 %USERPROFILE%\.pm2\dump.pm2

# 4. 验证服务
Get-Service pm2          # 期望: Running, StartType=Automatic
```

### 卸载

```powershell
pm2-startup uninstall
```

### 注意事项

- `pm2 save` 必须执行：服务启动后跑的是 `pm2 resurrect`，读 dump.pm2 中的列表。新增/移除进程后要再次 `pm2 save`。
- PM2 服务以**当前用户**身份运行；如需以 SYSTEM 账户跑，改用方案 B。
- 日志位置：`%USERPROFILE%\.pm2\logs\` 与 `D:\smart-control\logs\pm2-*.log` 同步。

---

## 方案 B — Windows 任务计划程序

把启动逻辑封装到 `boot.ps1`，注册一次性触发器“At startup”。

### 1) 创建 `D:\smart-control\deploy\windows-startup\boot.ps1`

> （随项目同步发布，无需手写。如缺失可按下面内容创建。）

```powershell
# 启动脚本: 由任务计划程序在开机时触发
$ErrorActionPreference = 'Continue'
$logDir = 'D:\smart-control\logs'
if (-not (Test-Path $logDir)) { New-Item -ItemType Directory -Path $logDir | Out-Null }
$ts = Get-Date -Format 'yyyy-MM-dd HH:mm:ss'
"[$ts] boot.ps1 启动" | Out-File -FilePath (Join-Path $logDir 'boot.log') -Append -Encoding utf8

# 1. PM2 拉起 (resurrect 失败则用 ecosystem 启动)
try {
  & pm2 resurrect 2>&1 | Out-File -FilePath (Join-Path $logDir 'boot.log') -Append -Encoding utf8
} catch {
  & pm2 start 'D:\smart-control\deploy\ecosystem.config.js' --env production 2>&1 |
    Out-File -FilePath (Join-Path $logDir 'boot.log') -Append -Encoding utf8
}

# 2. Nginx 拉起 (如已存在 C:\nginx\nginx.exe)
$nginx = 'C:\nginx\nginx.exe'
if (Test-Path $nginx) {
  Start-Process -FilePath $nginx -WorkingDirectory 'C:\nginx' -WindowStyle Hidden
  "[$ts] nginx 已启动" | Out-File -FilePath (Join-Path $logDir 'boot.log') -Append -Encoding utf8
}
```

### 2) 注册任务

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\smart-control\deploy\windows-startup\boot.ps1'
$trigger = New-ScheduledTaskTrigger -AtStartup
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest

Register-ScheduledTask -TaskName 'SmartControl-Boot' `
  -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force
```

### 3) 验证

```powershell
Get-ScheduledTask -TaskName 'SmartControl-Boot'
Start-ScheduledTask -TaskName 'SmartControl-Boot'     # 不重启也能测试一次
Get-Content D:\smart-control\logs\boot.log -Tail 20
```

### 4) 卸载

```powershell
Unregister-ScheduledTask -TaskName 'SmartControl-Boot' -Confirm:$false
```

---

## 推荐组合

最简最稳的现场方案：

1. **方案 A** 负责 Node 进程（`pm2-startup install` + `pm2 save`）。
2. **Nginx** 通过自带的 `nssm` 注册为 Windows Service：
   ```powershell
   # 安装 NSSM (https://nssm.cc/) 后:
   nssm install nginx C:\nginx\nginx.exe
   nssm set    nginx AppDirectory C:\nginx
   nssm set    nginx Start SERVICE_AUTO_START
   nssm start  nginx
   ```

这样开机后 PM2 + Nginx 都由 Windows 服务子系统拉起，无需登录交互桌面。
