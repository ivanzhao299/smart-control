# Sprint-07 交付清单

## 目标
增强中控系统的自动化执行能力：定时执行、执行队列、并发锁、动作重试、执行取消、执行记录持久化、细粒度 WebSocket 推送，使系统具备"无人值守自动运行"基础。

## 后端

### 实体新增 / 扩展
- `SchedulerTask` 扩展：新增 `code` (唯一业务编码)、`nextRunAt` (下次执行时间)
- **`SceneExecution`** (新)：`executionId / sceneCode / sceneName / triggerType (manual|schedule|system) / triggerSource / status (pending|running|success|partial_failed|failed|cancelled) / startedAt / finishedAt / durationMs / totalActions / successCount / failedCount / resultSummary`

### SceneEngine 重构 (核心)
| 能力 | 实现 |
|---|---|
| **执行记录持久化** | 每次 `execute()` 即写 `SceneExecution` (pending)，运行中→success/partial_failed/failed/cancelled |
| **并发锁** | `running: Map<sceneCode, Handle>` + 队列重复检测，409 提示 `该场景正在执行中` / `已在执行队列中` |
| **FIFO 串行队列** | 多场景命令避免设备冲突；同一 sceneCode 锁定，不同 sceneCode 排队执行 |
| **动作重试** | 单动作最多 3 次，每次间隔 1s；记录 `attempts`；不影响其他动作 |
| **取消** | `cancel()` 区分 running (abort) 与 queued (移除 + 写 cancelled)；保留 stop 兼容 |
| **统计** | success_count / failed_count / duration_ms / failures[] 全部入库 |
| **触发分类** | `triggerType: manual/schedule/system` + `triggerSource` 字符串 |

### 新事件类型 (ControlBus)
- `scene_execution_started`
- `scene_execution_progress` (每动作完成后)
- `scene_execution_success`
- `scene_execution_partial_failed`
- `scene_execution_failed`
- `scene_execution_cancelled`

所有事件含：`executionId / sceneCode / sceneName / triggerType / triggerSource / status / totalActions / successCount / failedCount / durationMs / step / at`

Sprint-03 旧 `scene` 事件继续广播（向后兼容平板订阅）。

### Scheduler 增强
- `nextRunAt` 自动计算 (`CronJob.nextDate()`)；create / update / fire / enable 时刷新
- `POST /api/scheduler/:id/enable` + `POST /api/scheduler/:id/disable`：单独端点 (Sprint-06 走 PATCH 的方式仍可用)
- 触发场景时 `triggerType=schedule, triggerSource=scheduler:{name}`
- 执行后 `lastRunAt / lastRunStatus / lastRunMessage / nextRunAt` 同步入库
- 异常包裹：cron 触发器内部任何错误不影响其他任务 / 系统不崩

### 新增 API
| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/scenes/:code/cancel` | 取消正在执行/队列中的场景 |
| GET  | `/api/scenes/runtime/queued` | 当前等待执行的场景列表 |
| GET  | `/api/scene-executions` | 执行记录列表 (sceneCode / status / triggerType / 时间范围 / 分页) |
| GET  | `/api/scene-executions/:id` | 单条执行记录详情 |
| POST | `/api/scheduler/:id/enable` | 启用 |
| POST | `/api/scheduler/:id/disable` | 停用 |

## 前端

### 新页面
- `/admin/scene-executions` (`SceneExecutionsAdmin.vue`)
  - 筛选：场景 / 状态 / 触发方式 / 时间区间
  - 表格：成功/失败/总动作数、耗时、开始/结束时间、触发来源
  - 失败时 popover 展示完整 failures（含 attempts）
  - 正在 running/pending 时 3s 自动刷新
  - cancel 按钮（operator/admin）

### 增强
- `/admin/scheduler`：新增 **下次执行** 列；启用/停用切换走新 enable/disable 端点
- 平板各页面：底部固定 **执行状态条** `ExecutionStatusBar`
  - 显示当前/最近场景名 / 状态 (pending|running|success|partial_failed|failed|cancelled) / 触发方式 / 成功/失败/总 / 实时进度条 / 当前动作 / 失败提示
  - 来自 `scene_execution_*` WS 事件，独立于旧 `scene` 事件

### Pinia store
- `useSceneStore.activeExecution` (ActiveExecutionView) — 当前/最近一次执行的完整快照
- `useSceneStore.isExecutionRunning` — 计算属性
- `handleWs()` 同时处理 Sprint-03 `scene` 与 Sprint-07 `scene_execution_*`

### Service
- `adminExecutionService.list/detail/cancel`
- `adminSchedulerService.enable/disable`

## 实测

### 本地后端 smoke (PORT=3300, mock)
```
=== 执行 s07_test (含 hvac 超界, 应 partial_failed) ===
  executionId: 94cd1c85 status: pending  (立即返回 pending, 实际后台队列执行)
=== 等 8 秒后查询 ===
  #1 s07_test status=partial_failed ok=2/3 fail=1 duration=2411ms trigger=manual:system
=== 重复执行 ===
  {"success":false,"message":"该场景正在执行中: s07_test"}
=== cancel ===
  场景已取消 status: cancelled
=== 定时任务 */5 * * * * ===
  next: 2026-05-19T02:15:00.000Z (✓ Asia/Shanghai)
=== disable ===  next=None
=== enable  ===  next=2026-05-19T02:15:00.000Z (✓)
```

**重试验证**：`hvac.setTemperature(999)` 失败 → 重试 1 s 后再失败 → 再重试 1 s 后失败 → 失败计入。总耗时 `60ms (mock) × 3 + 1000ms × 2 ≈ 2180ms`，加其他动作 60-100ms ≈ 2410ms ✓

### 公网验证 (cnjinhu.top, mock 模式)
- `/control/api/system/info` → Sprint-07 v0.7.0
- `/control/api/scenes/sprint07_demo/execute` → 异步入队
- `/control/api/scene-executions` → `#1 status=partial_failed ok=2/3 fail=1 duration=2310ms`
- `/control/api/scheduler/1/disable` → enabled=false, nextRunAt=null
- `/control/api/scheduler/1/enable` → enabled=true, nextRunAt=次日 00:00

## 启动 / 测试

### 本地
```bash
cd backend && npm run build && npm run seed && npm run start:dev    # :3000
cd frontend && npm run dev                                          # :5173
```

### 生产 (cnjinhu.top)
- 平板：https://cnjinhu.top/control/
- 后台：https://cnjinhu.top/control/#/admin/scene-executions

### API 测试示例
```bash
# 1. 立即触发场景
curl -X POST https://cnjinhu.top/control/api/scenes/opening/execute

# 2. 监听 WS
node -e "const ws=new (require('ws'))('wss://cnjinhu.top/control/ws/status');ws.on('message',m=>console.log(m.toString()))"

# 3. 取消执行
curl -X POST https://cnjinhu.top/control/api/scenes/opening/cancel

# 4. 查询执行记录
curl 'https://cnjinhu.top/control/api/scene-executions?status=partial_failed&pageSize=20'

# 5. 启用/停用定时任务
curl -X POST https://cnjinhu.top/control/api/scheduler/1/disable
curl -X POST https://cnjinhu.top/control/api/scheduler/1/enable
```

## 错误处理保证
- ✓ cron 表达式错误：DTO 正则 + CronJob 解析双重校验，返回明确 409
- ✓ 单个动作失败：重试 3 次后才计入 failures，其他动作继续
- ✓ WS 推送失败：try/catch 静默，不影响主流程
- ✓ 定时任务 fire 抛错：service 内 try/catch + 写 failure 状态，不崩
- ✓ 取消：abort 后已完成动作不回滚，未执行动作直接停

## 范围边界 (本 Sprint 不做)
- ❌ AI / 云平台 / SaaS / 多园区 / 数据分析驾驶舱
- ❌ JWT 鉴权（前端权限仍是 localStorage 模拟）
- ❌ 跨场景依赖触发链 (scene-A 完成后自动触发 scene-B)
- ❌ 并发执行多个场景 (当前 FIFO 串行；多场景同时执行将影响设备稳定性)

> 严格按 Sprint 迭代。
