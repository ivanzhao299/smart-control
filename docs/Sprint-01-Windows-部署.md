# Sprint-01 现场部署 — Windows 11 / Advantech ARK-1220L

> 本文档针对**现场中控主机**部署，区别于云端开发演示环境 (`cnjinhu.top`)。
> 适用机型：**Advantech ARK-1220L-S6A2** + **Windows 11**

## 一、准备 (一次性)

### 1.1 安装 Node.js 20 LTS

下载安装包：
- https://nodejs.org/en/download (选 "Windows Installer 64-bit, LTS")
- 安装时勾选 **Add to PATH**

验证：
```powershell
node --version    # 应显示 v20.x.x
npm --version
```

### 1.2 安装 pnpm (推荐) 与 PM2

```powershell
# pnpm (规范要求)
npm install -g pnpm

# PM2 (进程守护)
npm install -g pm2

# Windows 开机自启 (一次性)
npm install -g pm2-windows-startup
pm2-startup install
```

### 1.3 准备目录

```powershell
# 在 D: 根目录建项目位置
New-Item -ItemType Directory -Path 'D:\smart-control' -Force
New-Item -ItemType Directory -Path 'D:\smart-control\database' -Force
New-Item -ItemType Directory -Path 'D:\smart-control\logs' -Force
New-Item -ItemType Directory -Path 'D:\smart-control\backups' -Force
```

### 1.4 拉取代码

```powershell
cd D:\smart-control
git clone https://github.com/ivanzhao299/smart-control.git .
# 或解压 zip 到此处, 目录结构应为:
#   D:\smart-control\backend\
#   D:\smart-control\frontend\
#   D:\smart-control\deploy\
#   D:\smart-control\scripts\
```

### 1.5 配置环境变量

```powershell
# 用 Windows 模板
Copy-Item backend\.env.example.windows backend\.env

# 按现场情况编辑 (记事本或 VSCode)
notepad backend\.env
```

**必须确认的项**：
- `PORT` (默认 3000，与平板端口一致)
- `DB_PATH=D:\smart-control\database\smart-control.db`
- `LOG_DIR=D:\smart-control\logs`
- `HOST_MACHINE=Advantech ARK-1220L-S6A2`
- `PLATFORM=windows`
- `MOCK_MODE=true`（首次跑通；现场对接真实设备后改 `false`）
- 各网关 `*_HOST` 按现场实际填写

## 二、首次启动

```powershell
cd D:\smart-control

# 编译 + PM2 启动 + 健康检查 (一气呵成)
powershell -ExecutionPolicy Bypass -File scripts\start.ps1

# 看到 "status: running, host: Advantech ARK-1220L-S6A2" 即成功
```

### 数据种子（首次部署需要）

```powershell
cd D:\smart-control\backend
pnpm seed     # 或 npm run seed
```

种子会建：`admin/admin123` 用户 + 6 个场景 + 8 个设备 + 16 项 UAT。

### 验证

浏览器访问：
- 健康检查：http://localhost:3000/api/system/health
- 系统信息：http://localhost:3000/api/system/info
- 系统资源：http://localhost:3000/api/system/status

PowerShell 测试：
```powershell
Invoke-RestMethod http://localhost:3000/api/system/health | ConvertTo-Json
```

预期输出：
```json
{
  "success": true,
  "message": "查询成功",
  "data": {
    "status": "ok",
    "apiStatus": "up",
    "databaseStatus": "up",
    "websocketStatus": "up",
    "schedulerStatus": "up",
    "deviceOnlineCount": 0,
    "deviceOfflineCount": 8,
    "uptime": 12,
    "memoryUsagePercent": 25.3,
    "cpuUsagePercent": 1.5,
    "app": "smart-control-backend",
    "env": "production",
    "platform": "windows",
    "host": "Advantech ARK-1220L-S6A2"
  }
}
```

## 三、日常运维

### 3.1 常用脚本（D:\smart-control\scripts\）

| 命令 | 作用 |
|---|---|
| `.\scripts\start.ps1` | 启动（含 build / install / PM2 start / 健康检查） |
| `.\scripts\stop.ps1` | 停止 |
| `.\scripts\stop.ps1 -All` | 停止所有 PM2 进程 |
| `.\scripts\restart.ps1` | 平滑重启（PM2 reload, 不丢请求） |
| `.\scripts\restart.ps1 -Build` | 重新编译后重启 |
| `.\scripts\restart.ps1 -Hard` | 强制重启 |
| `.\scripts\logs.ps1` | 跟随 PM2 实时日志 (Ctrl+C 退出) |
| `.\scripts\logs.ps1 -Err` | 只看 error 日志 |
| `.\scripts\logs.ps1 -Tail 200` | 看最近 200 行 |
| `.\scripts\logs.ps1 -App` | winston 应用日志 (今日 app-YYYY-MM-DD.log) |
| `.\scripts\backup.ps1` | 备份数据库 + .env + UAT 快照到 backups\YYYYMMDD-HHMMSS\ |
| `.\scripts\backup.ps1 -Keep 30` | 保留最近 30 份 |

### 3.2 PM2 原生命令

```powershell
pm2 status                                    # 进程状态总览
pm2 logs smart-control-backend --lines 100    # 最近 100 行
pm2 reload smart-control-backend --update-env # 平滑重启
pm2 describe smart-control-backend            # 详细信息
pm2 save                                      # 持久化当前进程列表
```

### 3.3 开机自启验证

```powershell
# 重启电脑后, PM2 应自动恢复
shutdown /r /t 0      # 谨慎执行 (会立即重启)

# 重启后验证
pm2 list              # smart-control-backend 应自动 online
```

如未自启，重新安装：
```powershell
pm2-startup uninstall
pm2-startup install
pm2 save
```

## 四、备份策略

### 自动备份（推荐用 Windows 计划任务）

任务名：**smart-control-daily-backup**
- 触发：每天 03:00
- 操作：
  - 程序：`powershell.exe`
  - 参数：`-ExecutionPolicy Bypass -File "D:\smart-control\scripts\backup.ps1" -Keep 14`
  - 起始位置：`D:\smart-control`

PowerShell 一键添加：
```powershell
$action = New-ScheduledTaskAction -Execute 'powershell.exe' `
  -Argument '-ExecutionPolicy Bypass -File "D:\smart-control\scripts\backup.ps1" -Keep 14' `
  -WorkingDirectory 'D:\smart-control'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
$principal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
Register-ScheduledTask -TaskName 'smart-control-daily-backup' `
  -Action $action -Trigger $trigger -Principal $principal -Description '中控数据库每日备份' -Force
```

### 手动一次备份
```powershell
.\scripts\backup.ps1
# 备份会保存到 D:\smart-control\backups\YYYYMMDD-HHMMSS\
```

## 五、远程维护

按规范，不使用 SSH，采用以下方式：

### 5.1 Tailscale（首选）
1. 下载安装：https://tailscale.com/download/windows
2. 用公司 Tailscale 账号登录
3. 中控主机加入 Tailnet 后，从工程师笔记本 ping 主机的 Tailscale IP 即可

### 5.2 Windows 远程桌面 (RDP)
1. 系统设置 → 系统 → 远程桌面 → 启用
2. 防火墙允许 3389 端口（仅内网或 Tailscale）
3. 工程师笔记本 mstsc → 输入 Tailscale IP

### 5.3 Web 后台
- 内网 / Tailscale 内访问 `http://<主机 Tailscale IP>:3000/api/system/health`
- 后续 Sprint 上前端后可访问完整后台

### 5.4 PowerShell 远程（PSRemoting，仅在受信任网络）
```powershell
# 中控主机一次性开启
Enable-PSRemoting -Force

# 工程师端
Enter-PSSession -ComputerName <主机IP> -Credential (Get-Credential)
```

## 六、故障排查

| 现象 | 排查步骤 |
|---|---|
| `pm2 status` 显示 errored | `.\scripts\logs.ps1 -Err -Tail 100` 看错误日志 |
| 端口被占用 | `Get-NetTCPConnection -LocalPort 3000` 查占用进程 → 改 `.env` PORT 或停占用 |
| 数据库无法写入 | 检查 `D:\smart-control\database\` 目录权限；确认 SQLite 文件未被其他进程锁 |
| 健康检查返回 databaseStatus: down | 重启服务；如仍失败检查磁盘空间 / 文件损坏 |
| 设备网关连不上 | `Test-NetConnection 192.168.50.20 -Port 80` 测试基础连通；后台运维监控看 4 网关状态 |
| 开机不自启 | 重装 `pm2-windows-startup` (见 3.3) |
| 时间不准 | `w32tm /query /status` 检查时间同步；NTP 设服务器 `ntp.ntsc.ac.cn` |

## 七、版本升级

```powershell
cd D:\smart-control

# 1. 备份
.\scripts\backup.ps1

# 2. 拉新代码
git pull

# 3. 安装新依赖 + 重新编译
cd backend
pnpm install
pnpm build
cd ..

# 4. 重启服务 (平滑)
.\scripts\restart.ps1
```

## 八、Sprint-01 完成检查表

部署完成时应满足：

- [x] PowerShell `pm2 list` 显示 `smart-control-backend online`
- [x] `Invoke-RestMethod http://localhost:3000/api/system/health` 返回 success
- [x] 返回字段含 `platform: "windows"` + `host: "Advantech ARK-1220L-S6A2"`
- [x] `D:\smart-control\database\smart-control.db` 文件存在
- [x] `D:\smart-control\logs\app-<today>.log` 持续写入
- [x] 重启计算机后 PM2 自动恢复
- [x] `.\scripts\backup.ps1` 能产生 `backups\YYYYMMDD-HHMMSS\` 快照
- [x] Tailscale 已加入，工程师笔记本可访问

满足后即可进入 Sprint-02（已在 repo 中，无需重新开发）。
