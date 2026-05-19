# 展贸中心智能化中控系统 (Smart Exhibition Control)

> 展厅自动化中控平台 — 统一控制灯光 / LED大屏 / 音响 / 中央空调 / 场景联动

## 当前版本

**Sprint-09：现场联调 / 测试体系 / UAT 验收** *(累计交付 Sprint-01 ~ 09)*

新增：测试中心 (`/admin/test-center`) 支持单设备 / 子系统 / 场景 / 网络 (ping + TCP 端口) 测试；测试日志独立表与正式 OperationLog 隔离；测试报告聚合；UAT 验收模块（16 项默认种子：6 场景 + 6 设备 + 4 稳定性）+ 通过率统计 + WS 实时同步；Device 实体扩展 `debugRemark / lastTestAt / lastTestResult`；联调清单导出；WS 新事件 `test_started/progress/success/failed / uat_updated`。

**部署目标**：
- 现场中控主机：**Advantech ARK-1220L-S6A2** / Windows 11 (路径 `D:\smart-control\`)
- 云端开发演示：cnjinhu.top (Linux, 仅用于 demo)

线上演示：
- 测试中心：https://cnjinhu.top/control/#/admin/test-center
- UAT 验收：https://cnjinhu.top/control/#/admin/uat

## 现场部署 (Windows 11 / ARK-1220L)

完整步骤见 [`docs/Sprint-01-Windows-部署.md`](./docs/Sprint-01-Windows-部署.md)。

一句话流程：
```powershell
# 一次性安装 (Node 20 + pnpm + PM2 + pm2-windows-startup)
npm install -g pnpm pm2 pm2-windows-startup
pm2-startup install

# 拉代码到 D:\smart-control\
git clone https://github.com/ivanzhao299/smart-control.git D:\smart-control
cd D:\smart-control
Copy-Item backend\.env.example.windows backend\.env
notepad backend\.env     # 编辑 DB_PATH / LOG_DIR / HOST_MACHINE / 网关 IP

# 启动
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

5 个运维脚本：
- `scripts\start.ps1` — 启动 (含 build + PM2 + 健康检查)
- `scripts\stop.ps1` — 停止
- `scripts\restart.ps1` `[-Build] [-Hard]` — 重启
- `scripts\logs.ps1` `[-Err] [-Tail N] [-App]` — 查日志
- `scripts\backup.ps1` `[-Keep 14] [-Dest path]` — 备份数据库 + .env + UAT 快照

健康检查返回含 `platform: "windows"` + `host: "Advantech ARK-1220L-S6A2"`，便于运维识别主机。

## 现场联调与上线流程 (Sprint-09)

### 1. 单设备测试
进入 **后台 → 测试中心 → 单设备测试**：选设备 → 选命令（按类型自动联想：lighting=turnOn/setBrightness... led=powerOn/playMedia... 等）→ 填 JSON 参数 → 点 "测试"。结果即时显示成功/失败 + 耗时 + 完整 adapter 返回数据。

### 2. 子系统测试
**测试中心 → 子系统测试**：选 lighting/led/audio/hvac/power 之一 → 留空命令则用默认 `getStatus` → 一键批量测试该子系统下所有设备。表格逐行显示每个设备结果，失败原因可见。

### 3. 场景测试
**测试中心 → 场景测试**：选场景 → 勾选 **dryRun** 仅校验配置不下发设备；不勾则真实执行（但走测试通道，写 `test_logs` 不污染正式 `operation_logs`）。

### 4. 网络连通测试
**测试中心 → 网络连通**：填 IP + 端口
- `▶ Ping`：调用系统 `ping -c 1`，显示是否可达与延迟
- `▶ TCP 端口`：用 Node `net.Socket` 连接探测，常用于检查 80/502/5200 等控制端口

### 5. 记录 UAT
**后台 → UAT 验收**：左上角填入测试人姓名（自动保存到 localStorage）→ 列表中点 "录入" → 填写实际结果与备注 → 点 **✓ 通过** / **✖ 失败** / **需调整**。顶部 6 张卡实时显示总数 / 已通过 / 失败 / 需调整 / 待测 / 通过率。

### 6. 判断系统可上线
当以下条件全部满足时可以正式上线：

- ✅ UAT **通过率 ≥ 95%**，剩余项需明确"延后/不阻塞上线"备注
- ✅ 测试中心生成最近 24h 报告：失败数 = 0 或失败项已全部解决
- ✅ 后台 → 运维监控页：4 个网关全部 `online`，无 active critical 报警
- ✅ 后台 → 场景执行记录：6 个核心场景全部至少有 1 次 `success` 记录
- ✅ 联调清单接口 `GET /api/test/checklist` 返回 `failingItems: []`

### 7. 排查问题
- 设备不通 → 测试中心做 Ping → 失败则查物理网线 → 通了但设备没反应 → 看 `/admin/test-center` 单设备测试错误详情
- 报警不消除 → `/admin/alerts` 看 `lastError` 字段 → 修复后点 "解除"
- 场景执行失败 → `/admin/scene-executions` 看 failures 弹窗里的 attempts 与 error
- PM2 日志 → SSH 后 `pm2 logs smart-control-backend --lines 200`

## 历史版本

**Sprint-08：稳定性 / 健康检查 / 报警 / 运维监控** *(累计交付 Sprint-01 ~ 08)*

新增：Alert 模块（持久化报警 + 解除/忽略）· 增强 `/api/system/health` 含 CPU/内存/磁盘 + 服务状态聚合 · `/api/system/status` 系统资源 · `/api/logs/summary` 今日运行汇总 · 设备网关 0/5s/15s 三次重连退避 + 自动建报警 · 后台「运维监控」「报警中心」页 · 平板顶部持久化报警条 · PM2 ecosystem 完善（max_memory_restart 512M + exp_backoff_restart + 8s graceful kill）· 6 类新 WS 事件（device_online/offline · alert_created/resolved · system_health · service_status）

线上演示：
- 平板：https://cnjinhu.top/control/
- 后台监控：https://cnjinhu.top/control/#/admin/monitor
- 报警中心：https://cnjinhu.top/control/#/admin/alerts

## 运维操作速查 (Sprint-08)

### 查看系统状态
```bash
# 通过 API
curl https://cnjinhu.top/control/api/system/health           # 总体健康 + 资源摘要
curl https://cnjinhu.top/control/api/system/status           # CPU/内存/磁盘/版本/uptime 详情
curl https://cnjinhu.top/control/api/system/runtime/gateways # 4 个网关连接状态
curl https://cnjinhu.top/control/api/logs/summary            # 今日运行汇总
```

或直接浏览器打开后台 https://cnjinhu.top/control/#/admin/monitor

### 查看报警
```bash
curl 'https://cnjinhu.top/control/api/alerts?status=active'  # 当前激活报警
curl https://cnjinhu.top/control/api/alerts/summary          # 报警计数 + byLevel
```

或浏览器后台 https://cnjinhu.top/control/#/admin/alerts （可解除 / 忽略）

### 服务管理 (PM2)
```bash
# SSH 到服务器后
ssh -o BindInterface=en0 root@47.236.122.224

pm2 status                                          # 进程状态总览
pm2 logs smart-control-backend --lines 100          # 最近 100 行日志
pm2 logs smart-control-backend --err                # 只看 error
pm2 reload smart-control-backend --update-env       # 平滑重启 (优先, 不丢请求)
pm2 restart smart-control-backend --update-env      # 强制重启
pm2 stop smart-control-backend                      # 停止
pm2 describe smart-control-backend                  # 详细信息: cwd / 内存 / 重启次数

# 持久化 (开机自启)
pm2 startup
pm2 save
```

### 排查设备离线
```bash
# 1. 查 gateway 状态
curl https://cnjinhu.top/control/api/system/runtime/gateways

# 2. 触发立即健康探活
curl -X POST https://cnjinhu.top/control/api/system/runtime/health/probe

# 3. 查最近报警
curl 'https://cnjinhu.top/control/api/alerts?status=active&sourceType=gateway'

# 4. 看后端日志中的 reconnect 行
ssh root@47.236.122.224 'tail -200 /srv/data/smart-control/logs/app-$(date +%Y-%m-%d).log | grep -i "reconnect\|offline\|alert"'

# 5. 修复后, 后端会自动 reconnect; 也可点后台「立即探活」按钮
```

### 服务异常自恢复
- 进程崩溃 → PM2 自动重启（指数退避，min_uptime=15s）
- 内存超 512M → PM2 自动重启
- 设备网关掉线 → DeviceHealthService 立即/5s/15s 三次重连；失败后创建 critical alert
- 重连成功后 → 自动 resolve 对应 active alerts
- 数据库连接断 → /api/system/health 显示 `databaseStatus: down`；下次请求 TypeORM 自动重连

详见 [`frontend/README.md`](./frontend/README.md) · [`docs/Sprint-08-交付清单.md`](./docs/Sprint-08-交付清单.md)

## 历史版本

**Sprint-04：真实设备协议接入** *(累计交付 Sprint-01 + 02 + 03 + 04)*

新增：4 类真实 Adapter（DALI / 诺瓦 VX1000 LED / DSPPA·ITC 音响 / Modbus-TCP 空调）+ HTTP/TCP/Modbus 传输层 + 超时·重试·错误分类 + 自动重连·健康检查 + 网关连接状态注册表 + 灯光区域 API。

**仍不包含**：平板 UI / AI / 云平台 / 多园区 / SaaS。

## 技术栈

| 层 | 选型 |
|---|---|
| 运行时 | Node.js 20 LTS |
| 框架 | NestJS 10 + TypeScript 5 (strict) |
| 数据库 | SQLite (better-sqlite3) + TypeORM |
| WebSocket | `@nestjs/platform-ws` (native `ws`) |
| HTTP | Node 20 native `fetch` + AbortSignal |
| TCP | `net.Socket` 短连接, 自带超时/中止 |
| Modbus TCP | 自研最小 MBAP framer (FC 0x03/0x06) |
| 日志 | winston + 日滚动 |
| 进程守护 | PM2 |

## 适配器架构

```
backend/src/adapters/
├── errors.ts                      DeviceError / DeviceConnectionError / DeviceTimeoutError / DeviceOfflineError / DeviceProtocolError + classifyError()
├── retry.ts                       withTimeout(ms) + withRetry(retries, backoff)
├── adapter.types.ts               AdapterResult / AdapterContext (signal) / AbortedError / sleep
├── base.adapter.ts                通用 run() 包装: 计时 + 错误 → AdapterResult + mock 延迟
├── connection-registry.ts         网关 online/offline/reconnecting/error 状态广播
├── transports/
│   ├── http-client.ts             fetch + 超时 + 重试 + 错误分类
│   ├── tcp-client.ts              短连接 TCP, sendAndExpect(N bytes)
│   └── modbus-tcp.ts              最小 MBAP 实现 (Read Holding / Write Single Register)
├── lighting/
│   ├── lighting.adapter.ts        Facade (按 MOCK_MODE 切换 mock/real)
│   ├── mock-dali.adapter.ts       内存模拟
│   └── real-dali.adapter.ts       通过 DALI IoT Gateway HTTP REST
├── led/
│   ├── led.adapter.ts             Facade
│   ├── mock-led.adapter.ts
│   └── nova-led.adapter.ts        诺瓦 VX1000 + NUC 播控, TCP(默认) 或 HTTP
├── audio/
│   ├── audio.adapter.ts           Facade
│   ├── mock-audio.adapter.ts
│   └── real-audio.adapter.ts      DSPPA / ITC DSP, HTTP REST + 分区控制
├── hvac/
│   ├── hvac.adapter.ts            Facade
│   ├── mock-hvac.adapter.ts
│   └── modbus-hvac.adapter.ts     奥克斯中央空调, Modbus TCP
├── power/power.adapter.ts         (mock-only, Sprint-04 未扩展)
└── adapters.module.ts
```

## 真实协议要点

### DALI 灯光 — `RealDaliAdapter`
- 网关：DALI IoT Gateway (英飞特 DALI / Lunatone / Tridonic 类似)
- 协议：HTTP REST
- 寻址：`address` / `zone` / `group` 三种 scope，从 SceneAction 的 `params` 或 `deviceId` JSON 解析
  - 例 `params={"zone":2}` → `PUT /control/zone/2/level {level:80}`
  - 例 `params={"address":5}` → `PUT /control/address/5/level`
- 接口：on / off / setBrightness / recallScene / getStatus + `setZoneBrightness(zoneId, value)`

### 诺瓦 VX1000 LED — `NovaLedAdapter`
- 通过 Intel NUC 播控主机
- 通讯：`LED_TRANSPORT=tcp`（默认）发送 ASCII 文本指令 `<CMD> [arg]\n`；或 `=http` 用 REST
- 命令：`POWER_ON / POWER_OFF / INPUT <HDMI1|HDMI2|welcome|video> / PLAY <name> / STATUS`
- 输入切换：showWelcome / switchInput

### DSPPA / ITC 音响 — `RealAudioAdapter`
- HTTP REST + 分区
- 分区映射：`audio_1f → 1f_bg`, `audio_2f → 2f_bg`, `audio_meeting → meeting`, `audio_roadshow → roadshow`
- 命令：setVolume / mute / unmute / playBgm / stopBgm / enableMic
- 麦克风：enableMic 通过 source=mic 切换音源

### 奥克斯中央空调 — `ModbusHvacAdapter`
- 协议：Modbus TCP (默认端口 502)
- 寄存器：
  | 地址 | 含义 | 取值 |
  |---|---|---|
  | 0x00 | power | 0=off / 1=on |
  | 0x01 | mode | 0=cool / 1=heat / 2=fan / 3=auto / 4=dry |
  | 0x02 | set temp | ×10 (250 = 25.0°C) |
  | 0x03 | fan | 0=auto / 1=low / 2=mid / 3=high |
  | 0x10 | room temp | ×10 (只读) |
- 多机：deviceId 可编码 `{"slaveId":2}`，否则用 `HVAC_DEFAULT_SLAVE_ID`

## 超时·重试·错误体系

- **超时**：所有调用经 `withTimeout(DEVICE_TIMEOUT_MS, 默认 3000ms)`
- **重试**：`withRetry(DEVICE_RETRIES, 默认 3 次)`，指数退避 200ms/400ms/800ms
- **错误分类** (`classifyError`)：
  - `ECONNREFUSED / EHOSTUNREACH / ECONNRESET` → `DeviceConnectionError`
  - `timeout / ETIMEDOUT` → `DeviceTimeoutError`
  - HTTP 非 2xx / Modbus 异常码 → `DeviceProtocolError`
  - 业务层离线 → `DeviceOfflineError`
- 所有错误**不抛到 Service**，由 `BaseAdapter.run()` 转为 `AdapterResult{ok:false, error}` → SceneEngine 计入 `failures`

## 网关连接状态机 + 自动重连

`AdapterConnectionRegistry` 维护 4 个网关的状态：

```
                       success                 retry-fail
   register → offline ─────────→ online ─────→ reconnecting ──N×fail→ error
                ↑                  │
                └──── recovery ────┘
```

- 任意调用成功 → `markOnline`
- 失败且仍在重试窗口 → `markFailure(retrying=true)` → `reconnecting`
- 健康检查独立失败 → `markFailure(retrying=false)` → `offline`
- 每次状态变化通过 `ControlBus`：
  - `device_status` 事件 (gateway 名)
  - `alarm` 事件 (`level=warning` for reconnecting/offline, `error` for hard error)

## 健康检查

`DeviceHealthService` 应用启动 1 秒后执行首次 probe，之后按 `HEALTH_CHECK_INTERVAL_MS`（默认 15s）周期触发：

- 灯光：`GET /health`
- LED：`GET /api/status` 或 TCP connect 探活
- 音响：`GET /api/health`
- 空调：Modbus `Read Holding(0x00, 1)`

任一失败即更新注册表 + 广播 alarm。

## 启动与测试

### Mock 模式（默认，无真实设备）
```bash
cd backend
npm install
cp .env.example .env
npm run build && npm run seed
npm run start:dev          # MOCK_MODE=true
```

### 真实模式
```bash
cp .env.example .env
sed -i '' 's/MOCK_MODE=true/MOCK_MODE=false/' .env
# 按现场修改: DALI_GATEWAY_HOST / LED_HOST / AUDIO_HOST / HVAC_HOST 等
npm run start:dev
```

或直接命令行覆盖：
```bash
MOCK_MODE=false \
  DALI_GATEWAY_HOST=192.168.50.20 \
  LED_HOST=192.168.50.30 \
  AUDIO_HOST=192.168.50.40 \
  HVAC_HOST=192.168.50.50 \
  DEVICE_TIMEOUT_MS=3000 DEVICE_RETRIES=3 \
  npm run start:prod
```

### 切换方式总结

| 变量 | mock | real |
|------|------|------|
| `MOCK_MODE` | `true` | `false` |
| Adapter 行为 | `Mock*Adapter` 内存模拟 | `Real*Adapter` 走 HTTP/TCP/Modbus |
| 健康检查 | 始终 `ok:true` | 真实探活, 失败计入 retries |
| 网关注册表 | 空 | 4 网关 (lighting/led/audio/hvac) |
| 延迟 | `MOCK_LATENCY_MS` (80ms) | 真实网络 |

## 新增 API

| Method | Path | 说明 |
|--------|------|------|
| POST   | `/api/lighting/zone/:id/brightness` | 设置 DALI 区域亮度 (`{value:0-100}`) |
| GET    | `/api/system/runtime/gateways`     | 4 个网关连接状态 |
| GET    | `/api/system/runtime/health`       | 健康检查摘要 (interval/lastProbeAt/gateways) |
| POST   | `/api/system/runtime/health/probe` | 立即触发一轮健康检查 |

## 关键测试

### 1. Mock 回归
```bash
curl -X POST http://localhost:3000/api/lighting/zone/2/brightness \
  -H 'Content-Type: application/json' -d '{"value":75}'
# → {"success":true, "data":{"ok":true, "data":{"brightness":75,"on":true,"zone":2}, "mock":true}}
```

### 2. 真实超时 (无网关时)
```bash
MOCK_MODE=false DEVICE_TIMEOUT_MS=1500 DEVICE_RETRIES=2 npm run start:prod
sleep 8
curl http://localhost:3000/api/system/runtime/gateways
# → 4 个 gateway 均 offline, lastError 显示具体超时/连接拒绝原因
```

### 3. 真实成功 (用 fake DALI gateway 验证 retry)
启动一个故意前 2 次返回 500 的假网关：
```bash
node -e '
const http=require("http");
let n=2;
http.createServer((q,r)=>{
  if(n-->0){r.writeHead(500);r.end("err");return;}
  if(q.url==="/health"){r.writeHead(200);r.end(JSON.stringify({status:"ok"}));return;}
  let b=""; q.on("data",d=>b+=d); q.on("end",()=>{r.writeHead(200);r.end(JSON.stringify({level:80,on:true}))});
}).listen(18020);
'
# 另一终端启动后端指向 fake:
MOCK_MODE=false DALI_GATEWAY_HOST=127.0.0.1 DALI_GATEWAY_PORT=18020 npm run start:prod
# 期望: 健康检查前 2 次 500 后第 3 次成功, gateway 转 online
```

### 4. 失败隔离 (real 模式, 部分 gateway 可用)
执行包含 4 个设备类型的场景：
- lighting 成功 (fake gateway 在线)
- led / audio / hvac 失败 (无对应 gateway)
- OperationLog 记录 `succeeded=1 failed=3`
- WS 广播 4 条 alarm + 4 条 device_status + scene completion

### 5. WebSocket 状态推送
```bash
node -e "const ws=new (require('ws'))('ws://localhost:3000/ws/status');ws.on('message',m=>console.log(m.toString()))"
```
收到事件：
- `{type:"device_status", device:"lighting-dali-gateway", status:"online"|"offline"|"reconnecting"|"error", state:{endpoint,lastError,attempts}}`
- `{type:"scene", scene, executionId, status, ...}`
- `{type:"alarm", source, level, message}`

## 环境变量 (Sprint-04 新增)

| 变量 | 默认 | 说明 |
|------|------|------|
| `MOCK_MODE` | `true` | true=mock 实现, false=真实协议 |
| `DEVICE_TIMEOUT_MS` | `3000` | 单次设备调用超时 |
| `DEVICE_RETRIES` | `3` | 最大重试次数 (含首次) |
| `HEALTH_CHECK_ENABLED` | `true` | 是否启用定时健康检查 |
| `HEALTH_CHECK_INTERVAL_MS` | `15000` | 健康检查周期 |
| `DALI_GATEWAY_HOST/PORT/API_PATH/API_KEY` | `192.168.50.20:80` | DALI 网关 |
| `LED_HOST/PORT/TRANSPORT` | `192.168.50.30:5200/tcp` | LED 播控 |
| `AUDIO_HOST/PORT/DEFAULT_ZONE/API_KEY` | `192.168.50.40:80/1f_bg` | 音响 DSP |
| `HVAC_HOST/PORT/DEFAULT_SLAVE_ID` | `192.168.50.50:502/1` | 空调 |

## 网络规范

控制网 `192.168.50.0/24` 上的固定 IP 分配（可在 .env 修改）：

| IP | 设备 | 协议 |
|---|---|---|
| 192.168.50.20 | DALI Gateway | HTTP |
| 192.168.50.30 | LED 播控 NUC | TCP/HTTP |
| 192.168.50.40 | 音响 DSP | HTTP |
| 192.168.50.50 | 空调网关 | Modbus TCP (502) |

## 操作日志（Sprint-04 增强）

所有真实调用、健康检查失败、retry 触发的连接状态变更都会写入 `operation_logs`：

```
scene.execute 的 message 字段含完整 failures 数组:
  [
    { "deviceType":"led", "deviceId":"led_1f_main", "command":"showWelcome",
      "error":"tcp connect timed out after 1500ms to 192.168.50.30:5200" },
    ...
  ]

灯光 zone API 的 message 字段含调用元数据:
  {"zone":2, "value":75, "ok":true, "durationMs":85, "mock":false}
```

## 下一步 (Sprint-05 规划，尚未开发)

- 用户登录 / JWT / RBAC
- 定时场景 (cron 触发开馆/闭馆)
- 报警阈值规则 (室温过高、网关掉线时长)
- 厂商真实 SDK 调试与现场联调

> 严格按 Sprint 迭代，禁止跨 Sprint 开发。
