# CLAUDE.md — 项目记忆 (更新于 2026-07-26, commit 0548395)

> 金湖展贸中心智慧展厅中控系统。生产中，业主日常使用。
> 完整移交材料见 `docs/HANDOVER.md`（2026-06-01 版，架构/账号/硬件部分仍有效，本文件补充其后的变化）。

## 一行总览

整栋展厅"灯光 / LED 大屏 / 投影 / 音响 / 空调 / 电源"统一中控：
- **业主侧**：平板 PWA（Vue3）+ Android WebView 壳 APK + iOS 壳（`ios-app/`, TestFlight 流水线已搭）
- **后台** `/admin/*`：业主自助改硬件配置 / 灯光分区 / 场景 / 媒体库 / 时序器
- **主机**：GK9000 工控机（Windows 10, `D:\smart-control\`, 内网 192.168.77.54, WireGuard 10.66.66.3）
- **设备协议**：Modbus-TCP/RTU（DALI 灯光、空调、电源时序器）、诺瓦 V2460 VX/TCP（LED）、EKX808 HTTP（音响）、投影融合器 TCP

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vue 3 + Vite 5 + TS + Pinia + Element Plus（按需加载）+ PWA；设计 token 见 `docs/DESIGN_SYSTEM.md`（v3 蔚来车机风） |
| 后端 | NestJS 10 + TypeORM + better-sqlite3（单文件 + WAL）+ ws + winston；35 张实体表 |
| 移动壳 | Android Kotlin WebView（`android-app/`）；iOS（`ios-app/`, xcodegen `project.yml`） |
| 部署 | pm2（`deploy/ecosystem.config.js`）+ GitHub Actions CI 经 WireGuard 部署 |

## 目录速查

```
backend/src/
  adapters/    lighting(cy-dali64a)/led(诺瓦VX)/audio(EKX808)/hvac/power/projector(融合器) + transports
  modules/     31 个：核心新增 projector / dali-lights / audio-config / playback / media
  entities/    35 张表（audio-desired-link、dali-light、playlist-item、playback-history 等为 6 月后新增）
frontend/src/pages/   业主侧 13 页（新增 ProjectorPage / DaliLightsPage / DaliDiagnosePage / MediaPage）+ admin/
scripts/     GK9000 运维 PowerShell：update.ps1(主部署) / auto-update-watcher.ps1 / start-players.ps1
             player-watchdog.ps1 / ppt-player.ps1 / bgm-player.ps1 / boot-pm2.ps1 / deploy-from-ci.ps1
deploy/      nginx / windows-startup / ecosystem.config.js / aliyun-gk9000-jump-deploy.sh
docs/        HANDOVER.md(必读) / GK9000_WIREGUARD_CI_DEPLOYMENT.md / HOST_OPERATIONS.md / DESIGN_SYSTEM.md 等
```

## 本地开发

```bash
cd backend && cp .env.example .env   # MOCK_MODE=true 不接硬件
pnpm install && pnpm start:dev       # :3200
cd frontend && pnpm install && pnpm dev   # :5173, 路径 /control/
```
- 包管理器强制 pnpm（`only-allow pnpm`）。
- 前端 `pnpm build` 带 vue-tsc 类型检查；**生产机只跑 `pnpm build:deploy`**（纯 vite build，砍 vue-tsc 治 16G 内存 OOM）。类型检查放本地/CI 做。

## 部署链路（2026-07 现状）

1. **主路径**：push `main` → GitHub Actions `deploy-gk9000.yml` 验证构建 → SSH 阿里云跳板(123.57.220.65) → WireGuard → GK9000 跑 `scripts/deploy-from-ci.ps1`（锁 + 备份 + build + pm2 restart + 端口验证 + 失败回滚）。
2. **兜底**：GK9000 上 `auto-update-watcher.ps1` 定期 git pull 触发 `update.ps1`。
3. pm2 是**唯一进程属主**（2026-07-16 起）：`boot-pm2.ps1` 只负责开机 resurrect；旧计划任务重启方案已废。

### 部署坑（都踩过，勿回退）

- **PM2_HOME 必须固定** `C:\Users\user\.pm2`（机器级环境变量 + 各脚本显式 set）。CI 双跳 SSH 会话里 `$env:APPDATA`/`USERPROFILE` 是空的，用它拼 pm2 路径会生成孤儿 pm2 守护进程拖死主机（2026-07 连修 4 个 commit 才根治）。任何新脚本 shell 出 pm2 前都要显式 set PM2_HOME。
- **`frontend/components.d.ts`** 自动生成且历史上 tracked，拉代码常冲突；update.ps1 会先 `git checkout` 它。**别手改**。
- **CI 不跑 seed**。新增分区/灯组等种子数据要手工 `node dist/seed/seed.js`；且 `seedHardware` 遇已存在记录直接 skip，改已有生产数据走后台 UI。
- 监控心跳 payload 有封顶（治 "request entity too large" 失联），别在心跳里塞大对象；watcher 心跳里**不准调 `pm2 jlist`**（会孵化孤儿守护）。

## 关键领域知识

- **灯光模型**：light_zone(业主可见分区) → N × light_group，组的唯一键是 `(gatewayCode, daliGroup)` 二元组——两台 CY-DALI64A 共用一条 RS485（USR 透传, slaveId 1/2），**组号会重复，路由必须带 slaveId**。分区下发串行扇出（RS485 并发帧互踩）。
- **双路播控**：HDMI1→V2460→LED，HDMI2→投影。PlayerPage kiosk（Chromium ?slot=1/2）由 `playback` 模块经 WS `playback_channel_changed` 驱动；`player-watchdog.ps1` 守护 kiosk 进程。画面铺放模式可选（铺满/保持比例/裁切，默认铺满）。
- **文档投屏**（2026-07 新）：PPT 走原生放映保动画（`ppt-player.ps1`），Word 转 PDF 逐页，手机可翻页遥控。
- **投影融合器**（2026-07 新）：`adapters/projector/fusion-player-protocol.ts`（带 spec 测试），ProjectorPage 业主侧控制；融合器报警以文字警示行呈现。
- **音响**：分区立体声配对 UI；输入源现实接线 IN4=LED / IN5=投影（2026-07-24 对齐）。
- **电源时序器**：Modbus parseStatus 通道段偏移是**左移 1 字节**，曾因偏移方向修反导致"开了又弹回"，动这段先看 `114c6e4`/`714243f`。
- **双鉴权完全独立**：业主 `X-Client-Token`（localStorage, 30 天）vs 后台 `Bearer`（sessionStorage, 8h）。
- **fileUrl 必须 `absUrl()` 拼接**（frontend 5173 与 backend 3200 跨端口，原生 `<img>/<video>` src 不走 axios baseURL）。
- **UI 铁律**（业主 11+ 批验收整改沉淀）：页面固定壳——顶栏固定、内容区滚动、全局禁橡皮筋（但内部滚动容器/横向手势要放行）；卡片固定高度不被内容撑破；浅色主题对比度要过验收；危险操作要确认弹窗。改页面布局前先看 `0548395` 与 DESIGN_SYSTEM.md。

## 工作流约定

- 单人直推 `main`，无 PR 流程；commit message 中文、`type(scope): 描述` 格式，常带业主批次号。
- 密码等凭据永不进 git；默认密码 admin `jinhu888` / client `1234`（业主可能已改）。
- 中国大陆网络：Gradle 走阿里云 mirror，npm 走 npmmirror 兜底。

## 当前状态与 TODO

- 生产运行中：Sprint 1-10 + v3 视觉重构 + Android 1.0.5+ + 6-7 月体验升级（启动画面/骨架屏/状态光/微动效/离线胶囊/后台暂停轮询/CSS -79%/离线包 -39%）与全站验收整改（业主批次 1-11+）均已交付。
- TODO：真电表 DDS866 接入（power adapter 仍 Mock，框架已备）；1F DALI 网关 L2 Modbus 超时（现场硬件排查）；Android 生产签名上架；iOS TestFlight 等 secrets 到位。
