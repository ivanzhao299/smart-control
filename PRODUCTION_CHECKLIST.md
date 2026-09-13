# 上线检查清单 — 展贸中心智能化中控系统

> 现场主机：`GIADA GK9000 / Windows 10`
> 部署根：`D:\smart-control\`
> 上线判定：本清单 **全部 ✅** 方可正式交付运维。

执行人 / 日期：_____________________ / _____________________

---

## 一、网络与主机

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 1 | 固定 IP | `ipconfig` | IPv4 192.168.50.10 (或现场约定)，DHCP=否 | ☐ |
| 2 | 网关可达 | `Test-Connection 192.168.50.1 -Count 4` | 0% 丢包 | ☐ |
| 3 | DNS 解析 | `Resolve-DnsName cnjinhu.top` | 有 A 记录 | ☐ |
| 4 | 时间同步 | `w32tm /query /status` | LastSyncTime < 1 小时 | ☐ |
| 5 | Tailscale | `tailscale status` | 主机已加入运维网络且在线 | ☐ |
| 6 | RDP | 系统属性 → 远程 | 允许远程连接，端口 3389 开放 | ☐ |
| 7 | 防火墙 | `Get-NetFirewallRule` | 入站 TCP 80 / 3389 已放行 | ☐ |

## 二、运行进程

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 8 | PM2 | `pm2 status` | smart-control-backend = online, restart < 5 | ☐ |
| 9 | PM2 自启 | `Get-Service pm2` | Status=Running, StartType=Automatic | ☐ |
| 10 | Nginx | `Get-Process nginx` | ≥1 个进程 | ☐ |
| 11 | Nginx 自启 | `Get-Service nginx`（NSSM 注册时） | Status=Running, StartType=Automatic | ☐ |
| 12 | Node 后端 | `curl http://127.0.0.1:3000/api/system/health` | `apiStatus=up`, `databaseStatus=up` | ☐ |
| 13 | WebSocket | `deploy\scripts\health.ps1` | websocket = OK | ☐ |
| 14 | 健康检测脚本 | `deploy\scripts\health.ps1` | 退出码 = 0 | ☐ |

## 三、数据与配置

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 15 | SQLite 文件 | `Test-Path D:\smart-control\database\smart-control.db` | True，size > 0 | ☐ |
| 16 | DB 可写 | `pm2 logs --lines 50` 看 SceneEngine 写库不报错 | 无 SQLITE_READONLY | ☐ |
| 17 | NODE_ENV | `curl /api/system/info` | `env=production` | ☐ |
| 18 | MOCK_MODE | `curl /api/system/info` | `mockMode=false` | ☐ |
| 19 | TEST_MODE | `curl /api/system/info` | `testMode=false` | ☐ |
| 20 | version.json | `curl /api/system/info` | 返回 `version`/`buildTime`/`nodeVersion`/`host` | ☐ |

## 四、设备与业务

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 21 | 设备在线率 | `curl /api/devices` | offline 数 = 0（或现场已知离线项已备注） | ☐ |
| 22 | 4 个网关 | 后台 `/admin/monitor` | lighting / led / audio / hvac 全部 online | ☐ |
| 23 | 场景执行 | 后台 → 场景管理 → 任选一个点 "立即执行" | 完成 + 无失败 | ☐ |
| 24 | 定时任务 | `curl /api/scheduler/tasks` | 有任务的话 nextRunAt 已计算 | ☐ |
| 25 | UAT 通过率 | 后台 `/admin/uat` | ≥ 95%，剩余项有"延后/不阻塞"备注 | ☐ |
| 26 | 测试报告 | 后台 `/admin/test-center` → 生成 24h 报告 | failed = 0 | ☐ |
| 27 | 联调清单 | `curl /api/test/checklist` | `failingItems: []` | ☐ |
| 28 | 当前报警 | `curl /api/alerts?status=active` | list 为空，或全部已确认 | ☐ |

## 五、自动备份 & 自恢复

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 29 | 手工备份 | `scripts\backup.ps1` | backups/ 下出现 YYYYMMDD-HHMMSS 目录 | ☐ |
| 30 | 定时备份 | `Get-ScheduledTask SmartControl-Backup` | 存在，下次触发时间正确 | ☐ |
| 31 | 备份保留 | `Get-ChildItem D:\smart-control\backups` | 自动清理 > 14 份 | ☐ |
| 32 | 备份 API | `curl -X POST /api/system/backup` | 返回 snapshot 路径 + sizeBytes > 0 | ☐ |
| 33 | 恢复脚本 | `deploy\scripts\restore.ps1` (无参) | 列出快照列表 | ☐ |
| 34 | PM2 自愈 | `pm2 kill && deploy\windows-startup\boot.ps1` | 后端进程被重新拉起 | ☐ |

## 六、日志与可观测

| # | 项目 | 检查方式 | 通过标准 | ☑ |
| --- | --- | --- | --- | --- |
| 35 | 业务日志 | `Get-Item D:\smart-control\logs\app-*.log` | 今天的文件 size > 0 | ☐ |
| 36 | 错误日志 | `Get-Item D:\smart-control\logs\error-*.log` | 无未确认 stack | ☐ |
| 37 | Nginx 日志 | `C:\nginx\logs\smart-control.access.log` | 有请求记录 | ☐ |
| 38 | PM2 日志大小 | `Get-Item D:\smart-control\logs\pm2-*.log` | 单文件 < 100MB，winston 日切正常 | ☐ |
| 39 | logs/summary | `curl /api/logs/summary` | 返回今日操作 / 报警 / 场景 / 离线统计 | ☐ |

## 七、交付物

| # | 项目 | 通过标准 | ☑ |
| --- | --- | --- | --- |
| 40 | DEPLOY_WINDOWS.md | 已交付现场 / 已张贴控制室 | ☐ |
| 41 | WINDOWS_MAINTENANCE.md | 已交付运维 | ☐ |
| 42 | PRODUCTION_CHECKLIST.md | 本表全部 ✅ 后存档 | ☐ |
| 43 | 远程账号 | RDP / Tailscale 账号已交接 | ☐ |
| 44 | 应急联系人 | 三方联系人表已挂在控制室 | ☐ |

---

## 一键复核命令

```powershell
# 跑一遍核心三件套
deploy\scripts\health.ps1                       # 系统健康
curl http://127.0.0.1/api/system/info           # 版本/环境
curl http://127.0.0.1/api/test/checklist        # 业务联调清单
curl http://127.0.0.1/api/alerts?status=active  # 活动报警

# 输出全部为 OK / 空 → 可签字交付
```
