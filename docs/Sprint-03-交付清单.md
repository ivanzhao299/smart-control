# Sprint-03 交付清单

## 目标
建立中控系统核心：场景引擎 + 命令调度 + 设备适配 + 状态推送，使系统具备"执行场景"能力。

## 文件交付

### 新增 Adapter (`backend/src/adapters/`)
- `adapter.types.ts` — AdapterResult/AdapterContext/AbortedError/sleep
- `base.adapter.ts` — 模板方法，统一 mock 切换 + 错误捕获
- `lighting/lighting.adapter.ts` — turnOn/turnOff/setBrightness/recallScene/getStatus
- `led/led.adapter.ts` — powerOn/powerOff/switchInput/playMedia/getStatus
- `audio/audio.adapter.ts` — setVolume/mute/unmute/playBgm/stopBgm
- `hvac/hvac.adapter.ts` — turnOn/turnOff/setTemperature/setMode/getStatus
- `power/power.adapter.ts` — turnOn/turnOff/getStatus
- `adapters.module.ts`

### 新增核心服务 (`backend/src/services/`)
- `control-bus.ts` — 事件总线（Node EventEmitter）
- `device-status.service.ts` — 内存缓存 + 持久化可选 + 报警推送
- `command-dispatcher.service.ts` — 5 个 Adapter 统一调度
- `scene-engine.service.ts` — 顺序/并行/延时/停止，失败隔离，OperationLog 含失败明细
- `services.module.ts`

### 新增 Module (`backend/src/modules/`)
- `websocket/status.gateway.ts` + `websocket.module.ts` — WS `/ws/status` (native ws)
- `system/system.controller.ts` + `system.module.ts` — `/api/system/info` + runtime/*

### 修改文件
- `main.ts` — 注册 `WsAdapter`
- `app.module.ts` — 挂载 Adapters/Services/System/Websocket Module
- `modules/scenes/scenes.controller.ts` — 新增 execute / stop / runtime/running
- `modules/scenes/scenes.module.ts` — 引入 ServicesModule
- `common/config/configuration.ts` — 新增 adapter / websocket 配置
- `.env` / `.env.example` — 新增 `MOCK_MODE` / `MOCK_LATENCY_MS` / `WS_PATH`

### package.json 新增依赖
- `@nestjs/websockets@^10.3.10`
- `@nestjs/platform-ws@^10.3.10`
- `ws@^8.18.0`
- `@types/ws@^8.5.12` (devDep)

## 验收实测

| 项 | 命令 | 结果 |
|---|------|------|
| 系统信息 | `GET /api/system/info` | ✅ `mockMode:true, sprint:Sprint-03` |
| 并行执行 | sortOrder=1 三动作 | ✅ 时间戳完全一致 (57.163Z 三动作并发) |
| 顺序执行 | sortOrder=2,3 | ✅ 上一组完成后才推进 |
| 延时执行 | delayMs=200/300 | ✅ 实测延迟符合 |
| Stop 中止 | execute → 1.5s 后 stop | ✅ status=stopped，剩余动作未执行 |
| 失败隔离 | 4 个动作含 2 个故意失败 | ✅ succeeded=2 failed=2，其他动作不受影响 |
| 重复 execute | 同一 code 第二次 | ✅ 409 `场景正在执行中` |
| execute 不存在 | `no_such` code | ✅ 404 |
| stop 未执行 | 任意非运行 code | ✅ 404 |
| WS hello | 连接立即 | ✅ 收到 hello + 设备快照 |
| WS 推送 | 执行期间 | ✅ device_status / scene running/action/completed 全部推送 |
| OperationLog | scene.execute / scene.stop | ✅ message 含 executionId/failures JSON 详情 |

## 边界 (本 Sprint 不做)
- ❌ 真实协议: DALI/Modbus/厂商 SDK
- ❌ 平板 UI
- ❌ 用户登录 / JWT / RBAC
- ❌ 定时场景 / cron
- ❌ AI / 云平台 / SaaS / 多园区

> 严格按 Sprint 迭代。
