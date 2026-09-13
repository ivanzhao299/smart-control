# Sprint-08 交付清单

## 目标
让中控系统具备 7×24 稳定运行所需的健康检查、自动重连、故障报警、运维监控、资源采集等基础设施。

## 后端

### 实体新增
- `Alert` (`entities/alert.entity.ts`)
  字段：`id / level (info|warning|critical|emergency) / type / sourceType / sourceId / title / message / status (active|resolved|ignored) / resolvedAt / resolvedBy / createdAt / updatedAt`

### 新模块
- **`modules/alerts/`** — AlertService（含 dedupe 同源重复合并、autoResolveBySource）+ Controller + DTO
  - `POST /api/alerts/:id/resolve`
  - `POST /api/alerts/:id/ignore`
  - `GET /api/alerts` 多维筛选 + 分页
  - `GET /api/alerts/summary` 计数 + byLevel + last24h
- **`common/errors/`** — 统一错误体系
  - 从 adapters 重导 `DeviceConnectionError / DeviceTimeoutError / DeviceOfflineError`
  - 别名 `AdapterProtocolError = DeviceProtocolError`
  - 新增 `SceneExecutionError`

### Health 模块重构
- `HealthService`：`report()` 聚合 api/db/ws/scheduler/device 状态；`resources()` 采 CPU/内存/磁盘/uptime；CPU 用相邻两次采样差分（首次返回 0，第二次起准确）；磁盘用 `df -k <cwd>`
- `HealthController`：
  - `GET /api/system/health` → `{status, apiStatus, databaseStatus, websocketStatus, schedulerStatus, deviceOnlineCount, deviceOfflineCount, uptime, memoryUsagePercent, cpuUsagePercent, timestamp, app, env}`
  - `GET /api/system/status` → 完整系统资源 + 版本 + 平台 + pid

### DeviceHealthService 改造
- **重连策略改为 0 / 5s / 15s 三次**（spec Task-005）；三次都失败 → `AlertService.create({level:'critical', type:'gateway_offline', dedupe:true})`
- 重连成功 → `autoResolveBySource('gateway', name, 'gateway_offline')` 自动清除报警
- 增加状态转换检测：online↔offline 切换时分别推送 `device_online / device_offline` 事件
- 默认探活周期 30s（spec Task-003）；`reconnectInFlight` 防止并发重连

### Logs Summary
- `GET /api/logs/summary` — 今日：操作次数 / 场景执行 / 失败 / 设备离线（来自 OperationLog）+ 报警 active/last24h/byLevel（来自 AlertService）

### ControlBus 新事件
| 事件类型 | 触发时机 |
|---|---|
| `device_online` | 网关从非 online → online |
| `device_offline` | 网关从其他 → offline/error |
| `alert_created` | AlertService.create 成功 |
| `alert_resolved` | resolve / autoResolveBySource |
| `system_health` | (预留接口，HealthService.setWebsocketStatus / setSchedulerStatus 调用时推送) |
| `service_status` | (预留) |

### PM2 ecosystem 完善
```js
{
  name: 'smart-control-backend',
  exec_mode: 'fork',
  autorestart: true,
  max_restarts: 50,
  min_uptime: '15s',
  restart_delay: 2000,
  exp_backoff_restart_delay: 200,
  max_memory_restart: '512M',
  kill_timeout: 8000,           // 给运行中的场景 8s 优雅完成
  listen_timeout: 10000,
  shutdown_with_message: true,
  log_date_format: 'YYYY-MM-DD HH:mm:ss.SSS',
  // 三套 env: production / development
}
```

## 前端

### 新页面
- `/admin/monitor` (`MonitorAdmin.vue`)
  - 顶部 hero：系统状态 / 版本 / Sprint / 环境 / Node
  - 三仪表盘：CPU / 内存 / 磁盘（颜色按 70/90% 阈值）
  - 服务状态：API / DB / WS / Scheduler / Mock 模式
  - 运行时长：进程 / OS / PID / 架构
  - 设备在线率 + 4 网关状态
  - 当前报警计数 + byLevel 分类
  - 今日运行：操作 / 场景执行 / 失败 / 设备离线
  - 8s 自动刷新
- `/admin/alerts` (`AlertsAdmin.vue`)
  - 顶部 5 卡：active / 严重 / 警告 / 提示 / 24h
  - 6 维筛选：状态 / 等级 / 来源类型 / 子类型 / 时间区间
  - 列表 + popover 详细消息
  - 解除 / 忽略 按钮 + WS 自动刷新

### 平板报警条增强
- `AlertBanner.vue`：
  - 优先显示 in-memory 临时报警（旧逻辑保留）
  - 否则从 `/api/alerts?status=active` 拿持久化报警（按 emergency > critical > warning > info 优先级）
  - 点击跳转 `/status` 页
  - 30s 兜底轮询 + WS `alert_created/resolved` 触发即时刷新
  - 不阻塞控制操作

### 服务/类型
- `adminAlertService.list/summary/detail/resolve/ignore`
- `adminMonitorService.health/status/logsSummary`
- 新类型：`Alert / AlertLevel / AlertStatus / AlertSummary / HealthReport / SystemResources / LogsSummary`
- WS 事件类型扩展：`AlertCreatedWsEvent / AlertResolvedWsEvent / DeviceOnlineWsEvent / DeviceOfflineWsEvent / SystemHealthWsEvent / ServiceStatusWsEvent`

### 路由 / 菜单
- 新增 `/admin/monitor` + `/admin/alerts`，AdminLayout 菜单上移到首位
- `/admin` 默认重定向到 `monitor`

## 实测

### 后端 smoke (本地 :3300, mock)
```
GET /api/system/health
  → {"success":true,"status":"ok","apiStatus":"up","databaseStatus":"up","websocketStatus":"up","schedulerStatus":"up",
     "deviceOnlineCount":0,"deviceOfflineCount":8,"uptime":3,"memoryUsagePercent":99,"cpuUsagePercent":0,...}

GET /api/system/status
  → Sprint-08 v0.8.0 | node v24.15.0 | darwin
    cpu: 25.5% / load 4.02 / 12 cores
    mem: 16226/16384 MB (99%)
    disk: 81.08/460.38 GB (17.6%)

GET /api/alerts/summary
  → {active:0, byLevel:{info:0,warning:0,critical:0,emergency:0}, last24h:0}

GET /api/logs/summary
  → {operations:0, sceneExecutions:0, sceneFailures:0, deviceOffline:0, alerts:{...}}
```

### 公网验证 (cnjinhu.top, mock)
```
Sprint-08 v0.8.0 | node v20.20.2 | linux/x64
cpu: 1.5% / load 0.37 / 2 cores
mem: 807/7397 MB (10.9%)
disk: 5.75/39.01 GB (14.7%)
uptime: os 391755s, node 20s
logs/summary: operations:16, sceneExec:6 fail:1, offline:0, active alerts:0
```

## 错误处理保证 (spec 要求)
- ✓ 所有定时任务异常 → 内部 try/catch，仅写日志，不传播
- ✓ 场景动作失败 → SceneEngine.runGroup `Promise.allSettled`，单个失败不影响其他
- ✓ cron 错误 → DTO 正则 + CronJob 解析双重校验，返回明确 409
- ✓ WebSocket 推送失败 → `ControlBus.publish` 包 try/catch，不阻塞主流程
- ✓ 设备网关连续 3 次重连失败 → 创建 critical alert，仍保持 health probe 监控
- ✓ 数据库写 Alert 失败 → AlertService.create 内部捕获，记录到 winston，不导致主流程崩溃
- ✓ PM2 内存超 512M / 进程崩溃 → 自动重启（指数退避）

## 启动 / 测试 / API 示例

### 启动
```bash
# 本地
cd backend && npm run build && npm run seed && npm run start:dev      # :3000
cd frontend && npm run dev                                            # :5173

# 生产 (PM2)
pm2 start deploy/ecosystem.config.js --env production
```

### API 测试示例
```bash
# 健康检查
curl https://cnjinhu.top/control/api/system/health

# 系统资源
curl https://cnjinhu.top/control/api/system/status

# 创建场景失败后查报警 (设备未通时 schedule 失败会建报警)
curl 'https://cnjinhu.top/control/api/alerts?status=active'

# 解除报警
curl -X POST https://cnjinhu.top/control/api/alerts/1/resolve \
  -H 'Content-Type: application/json' -d '{"resolvedBy":"admin"}'

# 今日运行汇总
curl https://cnjinhu.top/control/api/logs/summary

# 立即健康探活 (后台调试用)
curl -X POST https://cnjinhu.top/control/api/system/runtime/health/probe

# WebSocket 订阅 (新事件)
node -e "
const ws = new (require('ws'))('wss://cnjinhu.top/control/ws/status');
ws.on('message', m => {
  const e = JSON.parse(m);
  if (['alert_created','alert_resolved','device_online','device_offline'].includes(e.type))
    console.log(e);
});
"
```

## 范围边界 (本 Sprint 不做)
- ❌ AI / 云平台 / SaaS / 多园区 / 数据分析驾驶舱
- ❌ 邮件 / 短信 / 微信报警通知（仅 WS + 后台界面）
- ❌ 历史趋势图（仅当前快照 + 8s 刷新）
- ❌ 跨进程分布式集群（仍单机 PM2 fork）

> 严格按 Sprint 迭代。
