# Sprint-05 交付清单

## 目标
为展厅平板端提供完整 Web UI / PWA 控制界面，支持场景一键切换、4 类子系统控制、设备状态与报警查看。

## 后端补齐 (新)

| Method | Path | 说明 |
|--------|------|------|
| POST | `/api/lighting/zone/:id/on`         | 区域开灯 (亮度 100) |
| POST | `/api/lighting/zone/:id/off`        | 区域关灯 |
| POST | `/api/lighting/zone/:id/brightness` | 区域亮度 (Sprint-04 已有) |
| POST | `/api/led/:id/on`                   | LED 开屏 |
| POST | `/api/led/:id/off`                  | LED 关屏 |
| POST | `/api/led/:id/play`                 | 播放视频 (body: `{media?}`) |
| POST | `/api/led/:id/welcome`              | 播放欢迎页 |
| POST | `/api/led/:id/input`                | 切换输入 (HDMI1/HDMI2/welcome/video) |
| POST | `/api/audio/:id/volume`             | 音量 (body: `{value,zone?}`) |
| POST | `/api/audio/:id/mute`               | 静音切换 (body: `{muted,zone?}`) |
| POST | `/api/audio/:id/play-bgm`           | 播放 BGM (body: `{track?,zone?}`) |
| POST | `/api/audio/:id/stop-bgm`           | 停止 BGM |
| POST | `/api/audio/:id/mic`                | 麦克风 (body: `{enable,zone?}`) |
| POST | `/api/hvac/:id/on`                  | 开机 |
| POST | `/api/hvac/:id/off`                 | 关机 |
| POST | `/api/hvac/:id/temperature`         | 温度 (body: `{value:16-30}`) |
| POST | `/api/hvac/:id/mode`                | 模式 (cool/heat/fan/auto/dry) |
| POST | `/api/hvac/:id/fan-speed`           | 风速 (auto/low/mid/high) |

每个调用自动记入 `operation_logs`，message 含 ok / error / durationMs / mock 元数据。

## 前端交付

### 项目结构 (frontend/)
- Vue 3 + Vite 5 + TypeScript strict
- Element Plus 2.x (按需自动导入)
- Pinia 2.x
- Axios + 自研 WebSocket 客户端 (心跳 + 指数退避重连)
- vite-plugin-pwa (fullscreen + landscape)

### 页面 (6 个)
1. **Dashboard** — 6 个场景大按钮 (180px 高) + 5 张子系统状态卡
2. **LightingPage** — 4 个 DALI 分区，单分区含亮度滑块 / 开关 / 实时反馈
3. **LedPage** — 2 个屏，含开关、4 种输入、欢迎页快捷、播放
4. **AudioPage** — 4 个分区，含音量滑块、静音、BGM、麦克风
5. **HvacPage** — 2 台空调，±温度大按钮、5 种模式、4 种风速
6. **StatusPage** — 中控信息 / 网关连接 / 设备列表 / 报警 / 一键探活

### 公共组件
- `StatusBar` — 时间 (实时秒) / 场景 / 在线数 / 网络 / 报警 / mock 标签
- `SceneButton` — loading / active / error 三种视觉状态
- `StatusCard` — online/running/reconnecting/error/disabled 5 种 pill
- `AlertBanner` — 顶部红/黄横幅，error 优先

### 状态管理 (3 store)
- `useSceneStore` — 场景列表、运行中、最后一次执行、`handleWs(scene)`
- `useDeviceStore` — 设备、runtime、gateways、`handleWs(device_status)`
- `useSystemStore` — 系统信息、ws 状态、报警队列 (最多 30 条)、时钟

### 服务封装 (8 个)
- `http.ts` — 统一 `api.get/post/put/del`，自动 unwrap `ApiOk<T>`，错误从后端 `message` 透传
- `websocket.service.ts` — 单例 WsClient: 心跳 25s / 指数退避 1s→15s / 多订阅
- `scene/device/lighting/led/audio/hvac.service.ts`

### PWA
- `manifest.webmanifest` 含 fullscreen + landscape + 主题色 `#111827`
- `sw.js` 由 workbox 生成，`navigateFallbackDenylist` 排除 `/api` `/ws`
- 192×192 / 512×512 PNG 图标 + 1 个 SVG favicon (由 `scripts/gen-icons.mjs` 生成)

## 实测

| 项 | 结果 |
|---|---|
| `vue-tsc` 严格类型检查 | ✅ 0 errors |
| `vite build` | ✅ `dist/` 含 30 个预缓存文件 (723 KiB) |
| `manifest.webmanifest` | ✅ display: fullscreen / orientation: landscape |
| `sw.js` | ✅ workbox 生成 |
| 前端代理后端 `/api/system/info` | ✅ `Sprint-05 / mockMode:true` |
| 新增 9 个 device API | ✅ 全部返回 `ok:true` |
| WS 端到端 | ✅ App.vue 启动即订阅，三 store 分发 |

## 启动方式

```bash
# 后端
cd backend
npm install && npm run build && npm run seed
npm run start:dev                   # PORT=3000 默认

# 前端 (新终端)
cd frontend
npm install
npm run icons                       # 一次性生成 PWA 图标
npm run dev                         # http://localhost:5173 (Vite 代理 /api /ws → :3000)
```

生产部署：`npm run build` 输出 `frontend/dist`，使用 Nginx/Caddy 静态托管并反代 `/api /ws` 到 backend (或直接放到 backend 静态目录)。

## 范围边界 (本 Sprint 不做)
- ❌ AI / 云平台 / SaaS / 多园区 / 数据分析驾驶舱
- ❌ JWT 登录 / RBAC
- ❌ 真实 DALI/Nova/DSP 协议联调 (Sprint-04 已留接口, 现场对接)
- ❌ ERP 后台 / 复杂表单 / 多层级菜单

> 严格按 Sprint 迭代。
