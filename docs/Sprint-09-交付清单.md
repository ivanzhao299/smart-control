# Sprint-09 交付清单

## 目标
为现场设备联调、系统测试、UAT 验收和故障排查提供完整工具体系，让工程师能快速定位问题、验收人员能清晰记录验收结果。

## 后端

### 新增实体
- `TestLog` (`entities/test-log.entity.ts`)
  - 字段：`testType (device|subsystem|scene|network_ping|network_port) / targetType / targetId / command / params / result / success / durationMs / operator / createdAt`
- `UatRecord` (`entities/uat-record.entity.ts`)
  - 字段：`itemName / category (scene|device|stability|other) / testStep / expectedResult / actualResult / status (pending|passed|failed|need_adjustment) / tester / remark / sortOrder`
- `Device` 扩展：新增 `debugRemark / lastTestAt / lastTestResult`

### Test Center 模块 (`modules/test-center/`)
- `POST /api/test/device/:deviceId` — 单设备测试，直接走 CommandDispatcher，不经 controller 路径，不写 OperationLog
- `POST /api/test/subsystem/:type` — 批量测试某类设备（默认 `getStatus` 探活）
- `POST /api/test/scene/:sceneCode` — 场景测试，支持 `dryRun:true` 仅校验不下发
- `POST /api/test/network/ping` — 调用系统 `ping -c 1`，跨 Linux/macOS
- `POST /api/test/network/port` — Node `net.Socket` TCP connect 探测
- `GET /api/test/logs` + `GET /api/test/logs/:id` — 测试日志查询（独立表）
- `POST /api/test/report` — 聚合最近 24h 测试报告：总数 / 成功 / 失败 / 平均耗时 / byTestType / 失败明细
- `GET /api/test/checklist` — 联调清单：设备列表 + IP 列表 + 最近 ping 结果 + 失败项

### UAT 模块 (`modules/uat/`)
- 完整 CRUD：`GET / GET/:id / POST / PUT/:id / DELETE/:id`
- 状态转换：`POST /:id/pass`、`POST /:id/fail`、`POST /:id/need-adjustment`、`POST /:id/reset`
- `GET /api/uat/summary` — 通过率聚合 + byCategory

### Seed 扩展
16 项默认 UAT：
- **场景**：6 个（开馆/接待/会议/路演/清洁/闭馆）含 testStep + expectedResult
- **设备**：6 个（灯光开关/调光、LED 开关/播放、音响音量、空调温度）
- **稳定性**：4 个（断网/断电恢复、设备离线提示、场景执行日志）

### ControlBus 新事件
- `test_started` / `test_progress` / `test_success` / `test_failed`
- `uat_updated`

### 统一错误体系
- 测试模块拒绝越界参数：IP 正则、端口 1-65535、命令长度
- 测试日志写入失败时 try/catch 不阻塞主流程

### system info / health 新增字段
- `testMode: process.env.TEST_MODE === 'true'`（默认 false，预留开关）
- `version: 0.9.0` `sprint: Sprint-09`

## 前端

### 新页面
- `/admin/test-center` (`TestCenterAdmin.vue`)
  - 6 个 tab：单设备 / 子系统 / 场景 / 网络 / 日志 / 报告
  - 单设备：设备下拉（按类型自动联想命令）+ JSON 参数 + 即时结果卡（含 adapter raw data）
  - 子系统：5 类选择 + 批量执行 + 每设备结果表
  - 场景：场景下拉 + dryRun 开关 + 每动作结果表
  - 网络：IP + 端口输入 + Ping + TCP 端口并排结果
  - 日志：testType + success 筛选
  - 报告：4 卡统计 + byTestType 表 + 失败明细
- `/admin/uat` (`UatAdmin.vue`)
  - 顶部 6 卡：总项数 / 已通过 / 失败 / 需调整 / 待测 / 通过率
  - 测试人姓名 localStorage 持久化
  - 行内编辑实际结果 / 备注 → ✓通过 / ✖失败 / 需调整 / 重置
  - WS `uat_updated` 实时同步

### services / 类型
- `adminTestService.device / subsystem / scene / ping / port / logs / report / checklist`
- `adminUatService.list / summary / create / update / remove / pass / fail / needAdjustment / reset`
- types：`TestLog / DeviceTestResult / SubsystemTestResult / SceneTestResult / PingResult / PortResult / TestReport / UatRecord / UatSummary / TestWsEvent / UatUpdatedWsEvent`

### AdminLayout 菜单
新增「测试中心」🧪 + 「UAT 验收」✅ 入口。

## 实测

### 本地 smoke (PORT=3300, mock)
```
=== UAT 数量 === total=16 pending=16 byCategory=['scene','device','stability','other']
=== 单设备 === setBrightness success=true 82ms
=== 子系统 lighting === 2/2 成功 166ms
=== 场景 dryRun === success=true total=1 ok=1
=== 端口 127.0.0.1:3300 === open=true 1ms
=== Ping 127.0.0.1 === reachable=true 0.038ms
=== 报告 === total=7 ok=7 fail=0 avg=59ms byTypes=['network_ping','network_port','scene','subsystem','device']
=== UAT pass === #1 场景:开馆模式 → passed
=== testMode === sprint=Sprint-09 v0.9.0 mock=true test=false
```

### 公网 (cnjinhu.top)
- UAT seed 后 16 项（首次部署自动建）
- 单设备测试公网调用通过：61ms
- 端口测试公网通过
- 联调清单：8 设备 / 0 网络目标 / 0 失败项

## 启动 / 测试方式

### 启动
```bash
cd backend && npm run build && npm run seed && npm run start:dev    # :3000
cd frontend && npm run dev                                          # :5173
# 访问 http://localhost:5173/#/admin/test-center
```

### API 测试示例
```bash
# 单设备
curl -X POST https://cnjinhu.top/control/api/test/device/light_1f_main \
  -H 'Content-Type: application/json' \
  -d '{"command":"setBrightness","params":{"value":80}}'

# 子系统
curl -X POST https://cnjinhu.top/control/api/test/subsystem/hvac \
  -H 'Content-Type: application/json' -d '{}'

# 场景 dryRun
curl -X POST https://cnjinhu.top/control/api/test/scene/opening \
  -H 'Content-Type: application/json' -d '{"dryRun":true}'

# 网络 Ping
curl -X POST https://cnjinhu.top/control/api/test/network/ping \
  -H 'Content-Type: application/json' -d '{"ip":"192.168.50.20"}'

# 端口
curl -X POST https://cnjinhu.top/control/api/test/network/port \
  -H 'Content-Type: application/json' -d '{"ip":"192.168.50.30","port":5200}'

# 报告
curl -X POST https://cnjinhu.top/control/api/test/report -d '{}'

# 联调清单
curl https://cnjinhu.top/control/api/test/checklist

# UAT
curl https://cnjinhu.top/control/api/uat/summary
curl -X POST https://cnjinhu.top/control/api/uat/1/pass \
  -H 'Content-Type: application/json' \
  -d '{"tester":"张工","actualResult":"按预期生效","remark":""}'
```

## 范围边界 (本 Sprint 不做)
- ❌ PDF 测试报告导出（当前仅 JSON）
- ❌ Excel 联调清单导出（当前仅 JSON）
- ❌ AI / 云平台 / 多园区 / 数据分析驾驶舱
- ❌ 跨场景批量 UAT 自动执行（仍人工录入）

> 严格按 Sprint 迭代。
