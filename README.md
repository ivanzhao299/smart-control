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

## Sprint-05 平板端 PWA 部署 (Windows 11 中控主机)

### 1. 在 ARK 主机上构建前端
```powershell
cd D:\smart-control\frontend

# 一次性安装依赖
pnpm install
# 或 npm ci

# 构建生产产物
pnpm build
# 产物在 D:\smart-control\frontend\dist\
```

### 2. 让后端直接 Serve 前端（最简单，无需 Nginx）

`backend\.env` 加：
```
SERVE_FRONTEND=true
FRONTEND_DIST_DIR=D:\smart-control\frontend\dist
```

> 当前后端默认通过 `@nestjs/serve-static`（如已启用）或可通过 Nginx for Windows 部署。

### 3. 用 IIS 或 Nginx for Windows 独立托管 (推荐生产)

```
http://<ark-ip>/        → 静态托管 D:\smart-control\frontend\dist
http://<ark-ip>/api/*   → 反代到 http://127.0.0.1:3000
http://<ark-ip>/ws/*    → 反代到 ws://127.0.0.1:3000  (Upgrade: websocket)
```

最简单：直接 `vite preview` 暴露 4173 端口，配合 PM2 守护：
```powershell
# 也可注册为 PM2 进程
pm2 start "pnpm preview -- --host 0.0.0.0 --port 4173" `
  --name smart-control-frontend `
  --cwd D:\smart-control\frontend
pm2 save
```

### 4. 平板 (HOTWAV R9 Ultra) PWA 安装

1. 平板连接展厅 WiFi (与中控主机同网段)
2. Chrome 打开 `http://<ark-ip>:4173/` (或 80 端口)
3. 浏览器菜单 → **添加到主屏幕** (Add to Home Screen)
4. 主屏图标点击 → 自动 PWA 全屏启动 (manifest 配置了 `display: fullscreen, orientation: landscape`)
5. 如果是普通浏览器访问，页面会自动弹「进入终端模式」遮罩，点任意位置进入全屏

### 5. 平板分辨率适配
- 设计基准：11 寸 1920×1200 横屏
- 主页 6 个场景按钮 3×2 网格，每个 ≥ 180px 高，专为触控
- 顶部 StatusBar 实时显示：时间 / 当前场景 / 设备在线数 / WS 状态 / 报警计数
- 底部 ExecutionStatusBar 显示场景执行进度（pending → running → success/failed）

### 6. WebSocket / API 地址配置

前端默认走相对路径 `/api` 和 `/ws/status`，由 Nginx / vite proxy 反代到后端。开发时：
```bash
# frontend/.env.local (开发)
VITE_PROXY_API=http://localhost:3000
```

生产环境 (PWA) 不需要 env，因为前端与后端通过反代在同一域名下。

### 7. 路由清单

| 路由 | 页面 |
|---|---|
| `/` | Dashboard (6 个场景按钮 + 5 个子系统状态卡) |
| `/lighting` | 灯光 (4 个 DALI 区域 + 调光) |
| `/led` | LED (2 屏 + 4 输入源 + 播放) |
| `/audio` | 音响 (4 分区 + 音量/静音/BGM/麦克风) |
| `/hvac` | 空调 (2 台 + 温度/模式/风速) |
| `/status` | 系统状态 (CPU/内存/在线率/网关/报警/设备列表) |

后台路由 `/admin/*` 见 [`frontend/README.md`](./frontend/README.md)。

## Sprint-04 真实设备接入配置 (现场)

### MOCK_MODE 切换

| 值 | 行为 | 适用 |
|---|---|---|
| `MOCK_MODE=true` | Adapter facade 选 mock 实现，零设备依赖 | 开发 / 演示 / 现场未接设备前 |
| `MOCK_MODE=false` | facade 选真实 Adapter (DALI HTTP / Nova TCP / DSP HTTP / Modbus TCP) | 现场设备就绪后 |

切换：
```powershell
# 编辑 backend\.env
MOCK_MODE=false

# Windows
.\scripts\restart.ps1

# Linux
pm2 reload smart-control-backend --update-env
```

### 设备配置 (在 `backend\.env`)

**全局**
```
DEVICE_TIMEOUT_MS=3000      # 默认超时 (Sprint-04 spec Task-008)
DEVICE_RETRIES=3            # 默认重试次数 (Sprint-04 spec Task-009)
# 重试默认 1000ms 固定间隔; 改 exponential 退避: DEVICE_RETRY_BACKOFF=exponential
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL_MS=30000   # 网关健康检查 (Sprint-04 spec Task-011)
```

**DALI 灯光 (西顿 + 英飞特 + DALI IoT Gateway)** ← `real-dali.adapter.ts`
```
DALI_GATEWAY_HOST=192.168.50.20
DALI_GATEWAY_PORT=80
DALI_API_PATH=/control
# DALI_API_KEY=<厂家 API Key>
```
- 寻址：SceneAction.params 用 `{"zone":1}` / `{"group":N}` / `{"address":N}` 三种 scope
- 一/二层公共区域、接待区、会议区 → 各自分配 zone 号

**LED 大屏 (诺瓦 VX1000 + Intel NUC 播控)** ← `real-led.adapter.ts` (= `nova-led.adapter.ts`)
```
LED_HOST=192.168.50.30
LED_PORT=5200
LED_TRANSPORT=tcp           # 或 http
```
- 输入切换：`switchInput({ input: 'HDMI1' | 'HDMI2' | 'welcome' | 'video' })`
- 播放视频：`playMedia({ media: 'welcome.mp4' })`

**音响 DSP (DSPPA / ITC)** ← `real-audio.adapter.ts`
```
AUDIO_HOST=192.168.50.40
AUDIO_PORT=80
AUDIO_DEFAULT_ZONE=1f_bg
# AUDIO_API_KEY=
```
- 分区映射：`audio_1f → 1f_bg`、`audio_2f → 2f_bg`、`audio_meeting → meeting`、`audio_roadshow → roadshow`

**奥克斯空调 (Modbus TCP)** ← `real-hvac.adapter.ts` (= `modbus-hvac.adapter.ts`)
```
HVAC_HOST=192.168.50.50
HVAC_PORT=502
HVAC_DEFAULT_SLAVE_ID=1
```
- 多台空调：SceneAction.deviceId 用 JSON `{"slaveId":2}` 指定不同从机
- 寄存器映射详见 [`backend/src/adapters/hvac/modbus-hvac.adapter.ts`](./backend/src/adapters/hvac/modbus-hvac.adapter.ts)（power/mode/setTemp/fan/roomTemp）

### 验证真实模式
```bash
# 1) 切到真实模式启动后
curl http://localhost:3000/api/system/runtime/gateways
# 期望: 4 个网关返回 online (设备已通) / offline (未通) / reconnecting (重连中)

# 2) 触发场景
curl -X POST http://localhost:3000/api/scenes/opening/execute

# 3) WS 监听细粒度状态推送 (PowerShell)
$ws = New-Object Net.WebSockets.ClientWebSocket
# 或用 wscat: npm i -g wscat; wscat -c ws://localhost:3000/ws/status
```

### 设备故障排查
- 后台 `/admin/monitor` → 看 4 个网关状态
- 后台 `/admin/test-center` → 网络 Ping + TCP 端口测试 + 单设备测试
- 后台 `/admin/alerts` → 看 `gateway_offline` 报警明细
- 系统日志：`pm2 logs smart-control-backend` 看 `reconnect` 与 `withRetry` 行
- 网关掉线流程：1 次失败立即重试 → 5s 再试 → 15s 再试 → 仍失败创建 `critical` 报警 → 网关恢复后自动 resolve

## Sprint-03 场景引擎使用 (核心)

### 创建场景 + 动作
```bash
# 1. 建场景
curl -X POST http://localhost:3000/api/scenes \
  -H 'Content-Type: application/json' \
  -d '{
    "code": "meeting_demo",
    "name": "会议模式演示",
    "actions": [
      {"deviceType":"lighting","deviceId":"light_1f_main","command":"setBrightness","params":{"value":80},"sortOrder":1},
      {"deviceType":"hvac","deviceId":"hvac_1f","command":"setTemperature","params":{"temperature":24},"sortOrder":2,"delayMs":500},
      {"deviceType":"led","deviceId":"led_1f_main","command":"showWelcome","sortOrder":3,"delayMs":1000}
    ]
  }'

# 2. 也可通过后台 /admin/scenes 用图形界面建
```

### 执行场景 (正式)
```bash
POST /api/scenes/:code/execute
curl -X POST http://localhost:3000/api/scenes/meeting_demo/execute
```
- 立即返回 `pending` 快照，后台 FIFO 队列异步执行
- 同场景重复执行 → 409
- 通过 WS `ws://host/ws/status` 订阅 `scene_execution_*` 事件看实时进度
- 完成后 GET `/api/scene-executions` 查看完整记录

### 测试执行场景 (Sprint-03 spec Task-010)
```bash
POST /api/scenes/:code/test
curl -X POST http://localhost:3000/api/scenes/meeting_demo/test
```
- 与 execute 共享 SceneEngine，但标记 `triggerType=system / triggerSource=test`
- MOCK_MODE=true 时不触发真实设备
- 在 `/admin/test-center` 也可图形界面调用 + dryRun 空跑模式

### MOCK_MODE 作用
- `MOCK_MODE=true` (默认)：所有 Adapter 走 mock 实现，不连真实设备，适合开发与现场未接设备前测试
- `MOCK_MODE=false`：lighting/led/audio/hvac 走真实协议 (DALI HTTP / Nova TCP / DSP HTTP / Modbus TCP)

切换：
```powershell
# 编辑 backend\.env
MOCK_MODE=false
DALI_GATEWAY_HOST=192.168.50.20
LED_HOST=192.168.50.30
AUDIO_HOST=192.168.50.40
HVAC_HOST=192.168.50.50

# 重启 (Windows)
.\scripts\restart.ps1
```

### 场景执行最终状态
- `success` — 全部动作成功
- `partial_failed` — 部分成功部分失败（不中断机制）
- `failed` — 全部失败
- `cancelled` — 用户取消 (`POST /api/scenes/:code/cancel`)

### 取消执行中的场景
```bash
curl -X POST http://localhost:3000/api/scenes/meeting_demo/cancel
```

### 关键日志位置
- OperationLog (action=`scene.execute` / `scene.execute.scheduled`) — DB 中查询 `/api/logs`
- SceneExecution (持久化完整执行记录) — `/api/scene-executions`
- winston 文件日志 — `D:\smart-control\logs\app-YYYY-MM-DD.log` (Windows)

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
