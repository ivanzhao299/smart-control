# 展贸中心智能化中控系统 — Windows 10 生产部署手册

> 适用主机：**GIADA GK9000 / Windows 10**
> 目标部署根：`D:\smart-control\`
> 不使用 Docker，所有进程以 Node + PM2 + Nginx 原生方式运行。

---

## 0. 部署前清单

| 项目 | 要求 |
| --- | --- |
| 操作系统 | Windows 10 (推荐 IoT Enterprise LTSC)，已激活 |
| 磁盘 | D: 盘剩余 ≥ 10 GB，独立于系统盘 |
| 网络 | 固定有线 IP（建议 192.168.50.10/24），可达所有设备网关 |
| 远程维护 | RDP 已开启 + Tailscale 已加入运维网 |
| 防火墙 | 允许入站 TCP 80（Nginx）/ 3000（仅 loopback）/ Tailscale UDP |
| 时区 | (UTC+08:00) 北京时间，自动同步开启 |
| PowerShell | 5.1+ (内置)；执行策略 `RemoteSigned` 或更宽松 |

```powershell
# 一次性执行策略放开 (管理员)
Set-ExecutionPolicy -Scope LocalMachine RemoteSigned
```

---

## 1. 软件安装

### 1.1 Node.js 20 LTS

下载 [Node.js 20.x msi](https://nodejs.org/) 安装。安装后：

```powershell
node -v         # v20.x.x
npm -v
```

### 1.2 pnpm

```powershell
npm i -g pnpm
pnpm -v
```

### 1.3 PM2 + Windows 自启

```powershell
npm i -g pm2 pm2-windows-startup
pm2 -v
```

### 1.4 Nginx for Windows

下载 [nginx-1.26.x.zip](https://nginx.org/en/download.html)，解压到 `C:\nginx\`。

```powershell
C:\nginx\nginx.exe -v
```

> 可选：用 [NSSM](https://nssm.cc/) 把 nginx 注册为 Windows Service（见 `deploy\windows-startup\README.md`）。

### 1.5 SQLite CLI（可选，备份脚本会自动降级）

下载 [sqlite-tools-win-x64.zip](https://sqlite.org/download.html) → 解压 `sqlite3.exe` 到 `C:\Windows\System32\`。

---

## 2. 代码部署

```powershell
# 1) 准备目录
New-Item -ItemType Directory -Path D:\smart-control -Force

# 2) 拉取代码 (任选其一)
# 2a) Git clone (推荐, 后续可 git pull 升级)
git clone https://github.com/ivanzhao299/smart-control.git D:\smart-control
# 2b) 离线: 直接把项目 zip 解压到 D:\smart-control\

# 3) 初始化 (装依赖 + 构建 + 注册 PM2)
cd D:\smart-control
deploy\scripts\init.ps1
```

`init.ps1` 会：

1. 创建标准目录 `backend/ frontend/ database/ logs/ backups/ deploy/`
2. 校验 Node ≥ 20 / pnpm / pm2 / nginx
3. 从 `backend\.env.example` 复制 `backend\.env`（首次部署需手动编辑）
4. `pnpm install` 后端 + 前端
5. `pnpm run build` 后端 (`backend/dist/`) + 前端 (`frontend/dist/`)
6. `pm2 start deploy/ecosystem.config.js --env production && pm2 save`

---

## 3. 关键配置：`backend\.env`

打开后修改下面这几行（其它保持默认即可）：

```ini
NODE_ENV=production
PORT=3000

# 数据库路径 (Windows 用双反斜杠)
DB_PATH=D:\\smart-control\\database\\smart-control.db

# 日志根 (winston daily-rotate 输出位置)
LOG_DIR=D:\\smart-control\\logs

# 现场上线必须关闭 Mock, 改用真实 Adapter
MOCK_MODE=false

# 主机标识 (出现在 /api/system/health 中, 便于运维识别)
HOST_MACHINE=GIADA GK9000
PLATFORM=windows

# 备份目录 (POST /api/system/backup 会落到这里)
BACKUP_DIR=D:\\smart-control\\backups
```

> 修改后必须 `pm2 restart smart-control-backend --update-env` 才会生效。

---

## 4. Nginx 反向代理

把项目自带的 Nginx 配置接入 Nginx 的主配置：

```powershell
# 1) 拷贝站点配置
New-Item -ItemType Directory -Path C:\nginx\conf\sites -Force | Out-Null
Copy-Item D:\smart-control\deploy\nginx\smart-control.conf -Destination C:\nginx\conf\sites\

# 2) 在 C:\nginx\conf\nginx.conf 的 http {} 块内追加一行:
#      include  sites/*.conf;

# 3) 验证 + 启动
C:\nginx\nginx.exe -t
C:\nginx\nginx.exe                # 启动
# 后续:
C:\nginx\nginx.exe -s reload      # 重载
C:\nginx\nginx.exe -s stop        # 停止
```

确认：

- `http://127.0.0.1/`        → 平板 UI
- `http://127.0.0.1/api/system/health` → JSON（apiStatus=up）
- `http://127.0.0.1/healthz` → 200

---

## 5. 启动方式

### 日常运维（已部署完毕）

```powershell
scripts\start.ps1               # 启动 (含 build + PM2)
scripts\stop.ps1                # 停止
scripts\restart.ps1             # 重启
scripts\logs.ps1                # 实时日志
scripts\backup.ps1              # 手工备份 (-Keep 14, -Dest 自定义)
deploy\scripts\health.ps1       # 全栈健康检测
deploy\scripts\restore.ps1      # 列出快照
deploy\scripts\restore.ps1 -Snapshot latest -Force      # 恢复最新
```

### PM2 直接命令

```powershell
pm2 status
pm2 logs smart-control-backend --lines 200
pm2 reload smart-control-backend --update-env
pm2 stop smart-control-backend
pm2 monit
```

---

## 6. 开机自启

详见 [`deploy\windows-startup\README.md`](deploy/windows-startup/README.md)。最简方案：

```powershell
pm2-startup install
pm2 save
# 把 Nginx 注册为 Windows Service (NSSM):
nssm install nginx C:\nginx\nginx.exe
nssm set    nginx AppDirectory C:\nginx
nssm set    nginx Start SERVICE_AUTO_START
nssm start  nginx
```

---

## 7. 日志查看

| 来源 | 路径 |
| --- | --- |
| 后端业务日志 (winston, 日滚动) | `D:\smart-control\logs\app-YYYY-MM-DD.log` |
| 后端错误日志 | `D:\smart-control\logs\error-YYYY-MM-DD.log` |
| PM2 stdout/stderr | `D:\smart-control\logs\pm2-out.log` / `pm2-error.log` |
| Nginx access | `C:\nginx\logs\smart-control.access.log` |
| Nginx error | `C:\nginx\logs\smart-control.error.log` |
| 开机自启 | `D:\smart-control\logs\boot.log` |

实时查看：

```powershell
scripts\logs.ps1
# 或者:
Get-Content D:\smart-control\logs\app-$(Get-Date -Format yyyy-MM-dd).log -Wait -Tail 100
```

---

## 8. 备份与恢复

- 手工备份：`scripts\backup.ps1`
- 定时备份（任务计划程序）：
  ```powershell
  $action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
              -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\smart-control\scripts\backup.ps1'
  $trigger = New-ScheduledTaskTrigger -Daily -At 3am
  Register-ScheduledTask -TaskName 'SmartControl-Backup' -Action $action -Trigger $trigger -RunLevel Highest
  ```
- 恢复：`deploy\scripts\restore.ps1 -Snapshot latest`（停 PM2 → 备份当前 → 覆盖 → 重启）
- API 触发：`POST /api/system/backup`、`POST /api/system/restore`（restore 为模拟，仅返回将要覆盖的路径，不会真改 DB）。

---

## 9. 排错速查

| 现象 | 检查 |
| --- | --- |
| 平板打不开页面 | `Get-Process nginx`；`C:\nginx\nginx.exe -t` |
| 平板能开但 API 500/connection refused | `pm2 status`；`pm2 logs smart-control-backend` |
| 网关全 offline | `deploy\scripts\health.ps1 -PingTargets '<网关IP1>,<网关IP2>'` |
| WebSocket 断 | `/api/system/runtime/health` 看 `attempts/lastError`；`deploy\scripts\health.ps1` |
| 数据库变只读 | 磁盘空间；杀掉 Excel 等占用 db 文件的进程 |
| PM2 自启失败 | `Get-Service pm2`；重跑 `pm2-startup install && pm2 save` |
| 升级后页面不刷新 (PWA 缓存) | 后台 → 设置 → "清除站点数据"，或浏览器强刷 |

---

## 10. 升级流程

```powershell
cd D:\smart-control
git pull --rebase
deploy\scripts\health.ps1            # 升级前留一份基线
scripts\backup.ps1                   # 强制备份
pnpm install --filter ./backend
pnpm install --filter ./frontend
pnpm run build --filter ./backend
pnpm run build --filter ./frontend
pm2 reload smart-control-backend --update-env
C:\nginx\nginx.exe -s reload          # 仅静态有改动时需要
deploy\scripts\health.ps1            # 升级后再来一次健康检测
```

完成 → 见 [`PRODUCTION_CHECKLIST.md`](PRODUCTION_CHECKLIST.md) 校验上线条件。
