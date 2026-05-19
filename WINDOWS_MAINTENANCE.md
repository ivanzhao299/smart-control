# 展贸中心中控系统 — Windows 运维手册

> 现场主机：`Advantech ARK-1220L-S6A2 / Windows 11`
> 部署根：`D:\smart-control\`
> 远程方式：**Tailscale + RDP**（无 SSH）

---

## 0. 远程接入

1. 在自己电脑上安装 [Tailscale](https://tailscale.com/) → 用相同账号登录后即可看到现场主机 Tailnet IP（一般是 `100.x.y.z`）。
2. Win + R → `mstsc` → 输入 Tailscale IP → 用现场约定的账号登录。
3. 备用方案（VPN 断时）：电话联系驻场工程师，通过有人值守的现场显示器接管。

> 安全：RDP 仅允许 Tailscale 内网入站，公网 3389 必须封掉。

---

## 1. 日常巡检（每周）

```powershell
# 1) 健康检测
deploy\scripts\health.ps1

# 2) 看磁盘 (D 盘日志/备份不要塞满)
Get-PSDrive D | Format-Table Name, Used, Free

# 3) 看备份保留情况 (默认 -Keep 14)
Get-ChildItem D:\smart-control\backups | Sort-Object Name -Descending | Select-Object -First 20

# 4) 当前报警
curl http://127.0.0.1/api/alerts?status=active

# 5) UAT/Test 中心 24h 报告
curl http://127.0.0.1/api/test/checklist
```

如全部通过 → 巡检记录归档（建议存 OneDrive 或现场 NAS）。

---

## 2. PM2 管理

| 操作 | 命令 |
| --- | --- |
| 查看进程 | `pm2 status` |
| 查看日志 (实时) | `pm2 logs smart-control-backend` |
| 查看错误日志 200 行 | `pm2 logs smart-control-backend --err --lines 200` |
| 重载 (无停机) | `pm2 reload smart-control-backend --update-env` |
| 重启 (有几秒中断) | `pm2 restart smart-control-backend --update-env` |
| 停止 | `pm2 stop smart-control-backend` |
| 启动 | `pm2 start D:\smart-control\deploy\ecosystem.config.js --env production` |
| 全部杀掉 | `pm2 kill`（慎用） |
| 保存进程列表 | `pm2 save`（修改进程后必须） |
| 监控仪表盘 | `pm2 monit` |
| 自启服务状态 | `Get-Service pm2` |
| 重装自启服务 | `pm2-startup uninstall && pm2-startup install && pm2 save` |

**自动重启策略**（已在 `deploy/ecosystem.config.js`）：

- `autorestart: true`
- `max_restarts: 50, min_uptime: 15s`
- `max_memory_restart: 512M`
- `exp_backoff_restart_delay: 200`（指数退避，避免崩溃风暴）

---

## 3. Nginx 管理

| 操作 | 命令 |
| --- | --- |
| 启动 | `C:\nginx\nginx.exe` |
| 重载配置 | `C:\nginx\nginx.exe -s reload` |
| 停止 | `C:\nginx\nginx.exe -s stop` |
| 强杀 | `Stop-Process -Name nginx -Force` |
| 配置测试 | `C:\nginx\nginx.exe -t` |
| Service 状态（NSSM 注册后） | `Get-Service nginx` |

修改了 `D:\smart-control\deploy\nginx\smart-control.conf` 之后：

```powershell
Copy-Item D:\smart-control\deploy\nginx\smart-control.conf C:\nginx\conf\sites\ -Force
C:\nginx\nginx.exe -t
C:\nginx\nginx.exe -s reload
```

---

## 4. SQLite 数据库

- 文件：`D:\smart-control\database\smart-control.db`
- 安全连接：服务运行时**禁止**用 DB Browser for SQLite 打开（会拿写锁）。需查表请：
  1. `pm2 stop smart-control-backend`
  2. 用 SQLite CLI 或 DB Browser 看
  3. `pm2 start smart-control-backend`

或者，使用只读快照（推荐）：

```powershell
scripts\backup.ps1
# 然后用最新 backups\YYYYMMDD-HHMMSS\smart-control.db 离线查询
```

### 常用 SQL 速查

```powershell
sqlite3 D:\smart-control\database\smart-control.db "select count(*) from devices where status='offline';"
sqlite3 D:\smart-control\database\smart-control.db "select level, count(*) from alerts where status='active' group by level;"
sqlite3 D:\smart-control\database\smart-control.db ".tables"
```

---

## 5. 备份 / 恢复

### 5.1 手工备份

```powershell
scripts\backup.ps1                       # 默认 backups\YYYYMMDD-HHMMSS\
scripts\backup.ps1 -Keep 30              # 保留 30 份
scripts\backup.ps1 -Dest E:\sc-backups   # 备份到 E 盘
```

### 5.2 定时备份（任务计划程序）

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' `
            -Argument '-NoProfile -ExecutionPolicy Bypass -File D:\smart-control\scripts\backup.ps1'
$trigger = New-ScheduledTaskTrigger -Daily -At 3am
Register-ScheduledTask -TaskName 'SmartControl-Backup' -Action $action -Trigger $trigger -RunLevel Highest
```

### 5.3 恢复

```powershell
deploy\scripts\restore.ps1                            # 列出所有快照
deploy\scripts\restore.ps1 -Snapshot latest -Force    # 恢复最新, 跳过交互
deploy\scripts\restore.ps1 -Snapshot 20260519-030000  # 指定快照
```

恢复时会自动：停 PM2 → 当前 DB 备份到 `pre-restore-*/` → 覆盖 → 重启 PM2。

---

## 6. 日志查看

| 命令 | 作用 |
| --- | --- |
| `scripts\logs.ps1` | PM2 logs 实时跟踪 (默认) |
| `pm2 logs --lines 500` | 最近 500 行 |
| `Get-Content D:\smart-control\logs\app-(Get-Date -Format yyyy-MM-dd).log -Tail 100 -Wait` | 业务日志实时跟踪 |
| `Get-Content D:\smart-control\logs\error-(Get-Date -Format yyyy-MM-dd).log -Tail 100 -Wait` | 错误日志实时跟踪 |
| `Get-Content C:\nginx\logs\smart-control.access.log -Tail 50 -Wait` | Nginx access 实时 |
| `Get-Content D:\smart-control\logs\boot.log -Tail 50` | 开机自启日志 |

业务日志由 `winston-daily-rotate-file` 按 `LOG_MAX_SIZE=20m` / `LOG_MAX_FILES=14d` 自动滚动，无需人工清理。

---

## 7. 常见故障处理

### 7.1 整个平板打不开

1. 看 Nginx：`Get-Process nginx`。没进程 → `C:\nginx\nginx.exe`
2. Nginx 起来还是 502：看后端 `pm2 status`，挂了就 `pm2 restart`
3. 都正常但 404：`C:\nginx\nginx.exe -t` 看配置；检查 `D:\smart-control\frontend\dist\index.html` 是否存在

### 7.2 设备全部 offline

1. `deploy\scripts\health.ps1 -PingTargets '<网关IP1>,<网关IP2>'`
2. 物理：交换机指示灯、网线
3. `curl /api/system/runtime/gateways` 看 lastError 字段
4. 改完 → `curl -X POST /api/system/runtime/health/probe` 立即探活

### 7.3 单个设备离线

后台 `/admin/test-center` → 单设备测试 → 看 rawResponse；或 `/admin/devices` 编辑此设备 → debugRemark / lastTestResult 字段。

### 7.4 PM2 自启失败（开机后没自动起）

```powershell
Get-Service pm2
# Status=Stopped 或者根本没这服务?
pm2-startup uninstall
pm2-startup install
pm2 start D:\smart-control\deploy\ecosystem.config.js --env production
pm2 save
```

也可改用 [`deploy\windows-startup\boot.ps1`](deploy/windows-startup/README.md) + 任务计划程序。

### 7.5 PWA 升级后页面没刷新

平板首页 → 设置 → "清除站点数据"；或 Chrome 强刷 (Ctrl+Shift+R)。Nginx 已为 `sw.js`/`manifest.webmanifest` 设了 `no-cache`，下次访问会拉到新版。

---

## 8. 升级流程

见 [`DEPLOY_WINDOWS.md` § 10](DEPLOY_WINDOWS.md)。

---

## 9. 联系与升级

- 故障升级路径：现场运维 → 二线驻场 → 三线（开发组）
- 紧急回滚：`deploy\scripts\restore.ps1 -Snapshot latest -Force` + `pm2 reload`
- 项目仓库：`https://github.com/ivanzhao299/smart-control`
