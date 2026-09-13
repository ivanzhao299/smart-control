# Sprint-04 交付清单

## 目标
将 Sprint-03 的 mock-only 系统升级为可对接真实硬件的中控平台，建立完整的协议层、超时·重试·错误体系、自动重连与健康检查。

## 文件交付

### 新增 (`backend/src/adapters/`)
- `errors.ts` — DeviceError 体系 + `classifyError()`
- `retry.ts` — `withTimeout` + `withRetry` (指数退避)
- `connection-registry.ts` — 网关连接状态机 (online/offline/reconnecting/error) + 广播
- `transports/http-client.ts` — fetch 包装, 重试+超时+错误分类
- `transports/tcp-client.ts` — 短连接 TCP, `sendAndExpect(N)`
- `transports/modbus-tcp.ts` — MBAP framer (FC 0x03 / 0x06)
- `lighting/mock-dali.adapter.ts` — 内存 mock (Sprint-03 逻辑迁移)
- `lighting/real-dali.adapter.ts` — DALI IoT Gateway HTTP REST
- `led/mock-led.adapter.ts`
- `led/nova-led.adapter.ts` — 诺瓦 VX1000 TCP/HTTP
- `audio/mock-audio.adapter.ts`
- `audio/real-audio.adapter.ts` — DSPPA/ITC DSP HTTP REST + 分区
- `hvac/mock-hvac.adapter.ts`
- `hvac/modbus-hvac.adapter.ts` — 奥克斯空调 Modbus TCP

### 修改 (4 个 Facade)
- `lighting/lighting.adapter.ts` — facade 按 `MOCK_MODE` 切换
- `led/led.adapter.ts`
- `audio/audio.adapter.ts`
- `hvac/hvac.adapter.ts`
- `adapters/adapters.module.ts` — 注册 mock+real 双套
- `services/services-primitives.module.ts` — 解决 ControlBus 循环依赖
- `services/services.module.ts` — 加入 DeviceHealthService
- `services/command-dispatcher.service.ts` — 增加 `showWelcome` / `enableMic` / `setFanSpeed`
- `entities/device.entity.ts` — DeviceStatus 新增 `reconnecting`

### 新增 Service / Module
- `services/device-health.service.ts` — 定时探活 4 个网关
- `modules/lighting/lighting.controller.ts` — `POST /api/lighting/zone/:id/brightness`
- `modules/lighting/lighting.module.ts`
- `modules/system/system.controller.ts` — 新增 runtime/gateways 与 runtime/health 路由

### 配置
- `.env` + `.env.example` 新增：
  `DEVICE_TIMEOUT_MS / DEVICE_RETRIES / HEALTH_CHECK_*`
  `DALI_* / LED_* / AUDIO_* / HVAC_*`

## 实测结果

### 1. Mock 模式回归 (MOCK_MODE=true)
- ✅ `POST /api/lighting/zone/2/brightness {value:75}` → `{ok:true, data:{brightness:75,on:true,zone:2}, mock:true, durationMs:81}`
- ✅ 场景执行 4 actions 全部 ok，WS 推送 11 事件 (4 action / 4 device_status / 2 scene + 1 hello)

### 2. 真实模式 - 无网关 (MOCK_MODE=false, hosts 不通)
- ✅ 4 个 gateway 全部 offline，按错误类型分类：
  - `operation timed out after 1500ms` (HTTP via withTimeout)
  - `tcp connect timed out after 1500ms to 192.168.50.30:5200`
- ✅ 场景执行 4 actions 全部 failed，OperationLog 含完整 failures
- ✅ WS 推送 6 alarm + 10 device_status + 6 scene 事件

### 3. 真实模式 - Fake DALI 网关 + retry
- 启动 fake 网关 (前 2 次返回 500, 第 3 次成功)
- ✅ 健康检查重试 3 次后成功，`lighting-dali-gateway` 转 `online`
- ✅ `POST /api/lighting/zone/3/brightness {value:65}` 成功
- ✅ fake-dali 收到 `PUT /control/zone/3/level body={"level":65}` -> 200

### 4. 失败隔离 (real 模式，仅 lighting 可用)
- ✅ 1 succeeded (lighting), 3 failed (led/audio/hvac)
- ✅ 单一 gateway 故障**不阻断**其他设备
- ✅ ECONNREFUSED 被正确分类为 `DeviceConnectionError`

## 边界

| 边界 | 行为 |
|------|------|
| Adapter 调用超时 | `DeviceTimeoutError` → withRetry 触发 → 最终 markFailure |
| 连接拒绝 | `DeviceConnectionError` → 同上 |
| HTTP 非 2xx | `DeviceProtocolError` (含状态码 + 响应片段) |
| Modbus 异常码 | `DeviceProtocolError` `slave exception code 0xN` |
| 健康检查失败 | gateway → `offline` + alarm `warning` |
| 业务调用失败 | gateway → `reconnecting` + alarm `warning` (供后续 retry) |
| Mock 模式 | 真实 Adapter 跳过 gateway 注册，registry 为空 |

## 边界 (本 Sprint 不做)
- ❌ 平板 UI / Vue 前端
- ❌ AI / 云平台 / SaaS
- ❌ 多园区
- ❌ JWT / RBAC / 用户登录
- ❌ 报警阈值规则
- ❌ 实际厂商 SDK 二进制集成 (Sprint-05 现场联调)

> 严格按 Sprint 迭代。
