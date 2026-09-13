# Smart Control - Frontend (Sprint-05)

平板端 Web UI / PWA 控制界面 · Vue3 + Vite + TypeScript + Element Plus + Pinia

## 适配目标
- 平板：HOTWAV R9 Ultra (11 英寸 · 1920×1200 · 横屏)
- 浏览器：Chromium / WebKit
- 部署方式：PWA 添加到主屏，全屏运行

## 启动

```bash
cd frontend
npm install
npm run icons          # 生成 PWA 图标 (192/512)
npm run dev            # http://localhost:5173 (代理 /api /ws 到 backend)
```

环境变量 (可选)：
```bash
VITE_PROXY_API=http://192.168.50.10:3000   # dev/preview 代理目标
VITE_API_BASE_URL=/api                     # 运行时 API 基址
VITE_WS_PATH=/ws/status                    # WebSocket 路径
```

## 构建 / 预览

```bash
npm run build          # 输出 dist/ (含 sw.js / manifest.webmanifest)
npm run preview        # 起 4173 预览
```

## 目录

```
frontend/src/
├── main.ts                       # 入口
├── App.vue                       # WS 订阅 + 初始数据
├── env.d.ts
├── router/index.ts               # 6 个路由 (dashboard/lighting/led/audio/hvac/status)
├── layouts/MainLayout.vue        # 顶部 StatusBar + 侧边导航 + AlertBanner
├── pages/
│   ├── DashboardPage.vue         # 6 个场景大按钮 + 5 个子系统卡片
│   ├── LightingPage.vue          # DALI 区域 开/关/亮度
│   ├── LedPage.vue               # 开屏/关屏/输入切换/欢迎页/播放
│   ├── AudioPage.vue             # 分区音量/静音/BGM/麦克风
│   ├── HvacPage.vue              # 开关/温度/模式/风速
│   └── StatusPage.vue            # 设备列表 + 网关 + 报警
├── components/
│   ├── StatusBar.vue             # 顶部状态栏 (时间/场景/在线/网络/报警)
│   ├── SceneButton.vue           # 大按钮 + loading/active/error
│   ├── StatusCard.vue            # 子系统状态卡片
│   └── AlertBanner.vue           # 顶部红色/黄色告警条
├── stores/
│   ├── scene.ts                  # 场景列表/执行中/执行结果
│   ├── device.ts                 # 设备/runtime/gateways
│   └── system.ts                 # WS 状态/报警/系统信息/时钟
├── services/
│   ├── http.ts                   # Axios + ApiOk<T> 解包 + 错误统一
│   ├── websocket.service.ts      # WS 客户端 (心跳/重连/事件分发)
│   ├── scene.service.ts
│   ├── device.service.ts
│   ├── lighting.service.ts
│   ├── led.service.ts
│   ├── audio.service.ts
│   └── hvac.service.ts
├── types/api.ts                  # 类型定义
└── styles/theme.css              # CSS 变量 + Element Plus dark + scrollbar
```

## 颜色 token

```css
--bg-base: #111827
--bg-panel: #1F2937
--color-primary: #2563EB
--color-success: #10B981
--color-warning: #F59E0B
--color-error: #EF4444
--text-primary: #F9FAFB
--text-secondary: #9CA3AF
```

## PWA

通过 `vite-plugin-pwa` 自动生成：
- `manifest.webmanifest` — display: fullscreen, orientation: landscape
- `sw.js` + workbox 缓存 (排除 `/api` `/ws`)
- 图标：`public/icons/pwa-{192,512}x{192,512}.png` (由 `npm run icons` 生成)

平板首次访问后点 “添加到主屏” → 全屏启动。

## 状态/错误反馈

- **WS 实时**：`device_status` / `scene` / `alarm` 三类事件分发到 3 个 store
- **顶部 AlertBanner**：有 `level=error/warning` 报警即显示，可一键清除
- **场景按钮**：loading 旋转 / active 高亮 / error 红框
- **页面级**：每张设备卡显示局部 error 提示，不阻塞其它操作
- **ElMessage**：操作成功/失败即时 toast
