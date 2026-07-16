# 项目移交材料 — 金湖展贸中心智慧展厅中控系统

> **接手人入门 1 小时读完**, 完整内容可以再花 1-2 天细看.
> 红色 ⚠️ 标的是**坑** / 必须留意的事, 直接踩可能跑不起来.

---

## 0. 一行总览

金湖展贸中心整栋展厅的"灯光 / LED 大屏 / 投影 / 音响 / 空调 / 电源"统一中控.
- **业主侧**: 一台平板挂墙, PWA 全屏 — 业主点磁贴一键场景切换 (开馆/接待/会议/路演/打扫/闭馆)
- **后台**: 业主自己也能改硬件配置 / 灯光分区 / 场景动作 / 媒体库 / 时间表
- **设备**: 通过 Modbus-TCP / Modbus-RTU / HTTP REST / TCP 协议直驱真实硬件

仓库: `git@github.com:ivanzhao299/smart-control.git` (Pro 账户私库, 已升级 GitHub Pro)

---

## 1. 技术栈

| 层 | 技术 | 备注 |
|---|---|---|
| 前端 | Vue 3 + Vite 5 + TypeScript + Pinia + Element Plus + vue-plugin-pwa | PWA standalone autoEnter 全屏, 设计 token 走 CSS variable, 见 `docs/DESIGN_SYSTEM.md` |
| 后端 | NestJS 10 + TypeORM + better-sqlite3 + WebSocket (ws) + winston | 单 SQLite 文件 + WAL, 适合小型展厅, 无外部依赖 |
| Android APP | Kotlin + Gradle 8.7 + AGP 8.5.2 + WebView | 纯壳, 加载 PWA URL, 内置版本检查 + 强制全屏 + 配置面板 |
| 部署 | pm2 (windows-service) + git pull + 自定义 watcher | GK9000 上 Win10, pm2 ecosystem 守护 backend + frontend (vite preview) |
| CI | GitHub Actions (Android APK build) | 仅 Android 用, 后端不走 CI |

代码体量: ~265 个 TS/Vue 源文件, ~50k 行 (大致 30k backend + 20k frontend).

---

## 2. 系统架构 (文字版)

```
┌────────────────────────────────────────────────────────────┐
│  业主平板 (Chrome PWA / Android APK 壳)                    │
│  - / dashboard, /lighting, /led, /audio, /hvac, /power     │
│  - /admin/*    (管理后台, 独立 admin 鉴权)                 │
└──────┬─────────────────────────────────────────────────────┘
       │  HTTP/JSON + WebSocket
       │  baseURL: http://192.168.77.54:3200/api (动态可配, ClientLogin 输)
       ↓
┌────────────────────────────────────────────────────────────┐
│  GK9000 Windows 10 主控机 (192.168.77.54)                 │
│  ├── backend (NestJS, pm2 id=50, port 3200)                │
│  │   ├── 28 模块, 22 张表, 见 §6                           │
│  │   ├── SQLite: D:/smart-control/database/smart-control.db│
│  │   └── 5 类硬件 adapter (lighting/led/audio/hvac/power)  │
│  ├── frontend (vite preview, pm2 id=1, port 5173)          │
│  │   └── 服务 dist/ 静态文件 + SPA fallback                │
│  └── kiosk PlayerPage × 2 (Chromium 全屏, HDMI1/2 输出)    │
│      └── scripts/start-players.ps1 启动                    │
└──────┬─────────────────────────────────────────────────────┘
       │
       │  ┌──── HDMI1 → 诺瓦 V2460 → 1F/2F LED 大屏
       │  ├──── HDMI2 → 投影仪
       │  │
       │  ├──── TCP/5200    诺瓦 V2460 VX 协议 (LED 控制器)
       │  ├──── TCP/502     Modbus-TCP (DALI 网关 + USR 串口透传 + HVAC + 电表)
       │  ├──── HTTP        EKX808 音响 (REST)
       │  └──── (可选 NUC HTTP)
       ↓
现场硬件:
- CY-DALI64A × 2 (灯光网关, 同一层, 共用一条 RS485 经 USR 透传, 靠拨码地址 1/2 区分)
- 诺瓦 V2460 LED 控制器 + 灯杆/吊顶 LED
- 投影仪 (HDMI2 输入)
- EKX808 音响 (HTTP)
- 空调网关 (Modbus-RTU 经 USR 透传)
- DDS866 智能电表 (Modbus-RTU, 计划接入)
```

外网访问: nginx (主域 cnjinhu.top → 公网) 反代 `erp.cnjinhu.top` → GK9000:3200/3201, 详见 §4.4.

---

## 3. 代码仓库

### 3.1 仓库 / 分支

- GitHub: **ivanzhao299/smart-control** (Private, GitHub Pro)
- 主分支: `main` — 一路 commit + push, 没有 PR 流程 (单人小团队, 直接 push)
- 接手后建议: 转双人模式后建 `develop` 分支, main 走 PR review

### 3.2 目录结构

```
smart-control/
├── backend/               # NestJS 后端
│   ├── src/
│   │   ├── adapters/      # 硬件协议适配器 (lighting/led/audio/hvac/power)
│   │   ├── entities/      # TypeORM 实体 (22 张表)
│   │   ├── modules/       # NestJS 模块 (28 个)
│   │   ├── services/      # 跨模块服务 (command-dispatcher 等)
│   │   ├── common/        # 守卫 / 配置 / 工具
│   │   ├── seed/          # 启动时 seed 默认数据
│   │   └── main.ts
│   ├── .env.example       # 配置模板, 部署时复制到 .env
│   └── package.json
│
├── frontend/              # Vue 3 前端 (PWA)
│   ├── src/
│   │   ├── layouts/       # MainLayout (业主侧) / AdminLayout (后台)
│   │   ├── pages/         # 10 业主侧 + 21 admin
│   │   ├── services/      # axios http 封装 + 各 module service
│   │   ├── stores/        # Pinia stores
│   │   ├── styles/        # design-tokens.css (v3 蔚来车机风)
│   │   ├── router/        # vue-router + 双 guard (client-auth + admin-auth)
│   │   └── main.ts
│   ├── vite.config.ts
│   └── package.json
│
├── android-app/           # Android WebView 壳 APK
│   ├── app/src/main/kotlin/com/jinhu/smartcontrol/  # MainActivity + UpdateChecker + Prefs
│   ├── app/src/main/res/                            # layouts, icons, themes
│   ├── icon-source.png    # 1254×1254 logo 源图, 改这个 + 跑脚本就出新 icon
│   └── build.gradle.kts
│
├── scripts/               # PowerShell + bash 运维脚本
│   ├── update.ps1                # 主部署脚本 (GK9000 上跑)
│   ├── auto-update-watcher.ps1   # 后台 watcher, 定期 git pull 触发 update
│   ├── start-players.ps1         # 启动 2 个 kiosk PlayerPage Chromium 窗口
│   ├── backup.ps1                # SQLite + .env 快照
│   ├── generate-android-icons.sh # 重新生成 5 套 mipmap launcher icon
│   ├── deploy-backend-remote.sh  # SSH 推 backend (从 mac)
│   └── ...
│
├── docs/                  # 工程文档 (28+ 个 .md)
│   ├── HANDOVER.md (本文档)
│   ├── DESIGN_SYSTEM.md           # v3 视觉系统全套 token + 模式
│   ├── EQUIPMENT_LIST.md          # 硬件设备清单 / 型号
│   ├── DALI_FIELD_INSTALL.md      # DALI 网关现场接线 / 路由配置
│   ├── AUDIO_*.md                 # 音响协议 / 现场安装
│   ├── HVAC_*.md                  # 空调
│   ├── GK9000_*.md                # GK9000 主机配置 / 自动更新
│   ├── HOST_OPERATIONS.md         # 主机运维手册
│   ├── ONSITE_UPDATE.md           # 现场升级流程
│   └── Sprint-*-交付清单.md       # 历史 Sprint 交付 (9 期)
│
├── database/              # SQLite 数据库目录 (D:/smart-control/database/ 在 GK9000)
│                          # 注意: 本地 mac 上一般没有, 只在 GK9000 实例
│
└── .github/workflows/
    └── android-build.yml  # Android APK CI build (需 GitHub Actions 配额)
```

### 3.3 ⚠️ git 忽略 / 不要 commit 的

- `backend/.env` — 数据库路径, 设备 IP, 密钥. **永远不上 git**
- `backend/database/*.db` — SQLite 数据
- `frontend/components.d.ts` — vite-plugin-vue 自动生成, 每次 build 会变, 已 .gitignore (历史 commit 过, 现在拉新分支会冲突, update.ps1 会先 `git checkout` 这个文件)
- `*.apk`, `*.aab` — Android 产物
- `*.jks`, `*.keystore` — 签名密钥 (目前用 debug 签名, 没生产 keystore)

---

## 4. 运行环境

### 4.1 GK9000 主机

| 项 | 值 |
|---|---|
| IP | **192.168.77.54** (内网静态) |
| OS | Windows 10 Pro x64 |
| 用户名 | `user` |
| 密码 | `<待填 — 业主告知接手人>` |
| 项目路径 | `D:/smart-control/` |
| 数据库 | `D:/smart-control/database/smart-control.db` |
| 日志 | `D:/smart-control/logs/` |
| 备份 | `D:/smart-control/backups/` (backup.ps1 写入) |
| Node.js | v20.18.0 (pm2 ecosystem 依赖) |
| pnpm | 全局, backend + frontend 用 |
| pm2 | 全局 + pm2-windows-service 注册成 Windows 服务, 开机自启 |
| SSH | OpenSSH Server 已装, 默认 22 端口 |

SSH 进 GK9000:
```bash
ssh user@192.168.77.54
# 内外网通, 不需要 VPN (业主自述)
```

### 4.2 端口分配

| 端口 | 服务 | 备注 |
|---|---|---|
| 22 | OpenSSH | 远程维护 |
| 3200 | NestJS backend HTTP + WebSocket | `.env PORT=3200` |
| 5173 | vite preview (frontend 静态服务) | pm2 进程 sc-frontend |
| 502 | (出口) Modbus-TCP 到 USR 串口透传 | 走外部硬件 |
| 5200 | (出口) 诺瓦 V2460 LED 控制器 | 走外部硬件 |
| 80 | (出口) EKX808 音响 HTTP / DALI 网关 web 配置页 | |

### 4.3 网络拓扑 / 设备 IP (实际填写需确认)

```
192.168.124.0/24  控制网段
  ├── 192.168.77.54  GK9000 主控机
  ├── 192.168.124.???  业主平板 (DHCP, 一般有)
  └── ...

192.168.50.0/24   设备网段
  ├── 192.168.50.20:502   RS485↔TCP 转换器 CONV-RTU-1 (USR)  ⚠️ 历史问题见 §10
  │                        └── 两台 CY-DALI64A 都挂在这条 RS485 上, 自己没有 IP,
  │                            靠拨码地址区分: slaveId=1 网关#1, slaveId=2 网关#2
  ├── 192.168.50.30:5200  诺瓦 V2460 LED 控制器
  ├── 192.168.50.40:80    EKX808 音响
  ├── 192.168.50.50:502   HVAC 空调网关 (USR 透传 Modbus-RTU)
  └── 192.168.50.???      DDS866 智能电表 (计划接入, 见 §10 Sprint G2)
```

⚠️ **以上设备 IP 必须跟现场实际 DHCP / 静态配置一致**, 改 `backend/.env` 对应的 `*_HOST` 字段. 关键变量:
- `DALI_RTU_HOST` (DALI 网关)
- `DALI_GATEWAY_HOST` (备用 HTTP 网关)
- `LED_HOST`
- `AUDIO_HOST`
- `HVAC_HOST`

### 4.4 外网域名 (可选)

- `cnjinhu.top` 主域 (在阿里云)
- `erp.cnjinhu.top` → 反代到 GK9000:5173 (frontend) + 3200 (API + WS)
- 详见 memory 索引: `~/.claude/projects/-Users-mac-jinhu-ERP/memory/server_cnjinhu_top.md`
- ⚠️ **外网域名公开, admin 后台一旦默认密码没改就有风险, 见 §5.1**

---

## 5. 关键账号 / 凭据 / 安全

### 5.1 ⚠️ 系统内置密码 (接手人**第一件事**就是改)

| 用途 | 默认密码 | 改的方法 |
|---|---|---|
| **后台管理员** (admin) | `jinhu888` | 进后台 → `/admin/system-branding` → 右下"改密码"板块 |
| **业主侧 PWA** (client) | `1234` | 进 `/admin/system-branding` 同页 (业主侧密码也可改) |
| **GK9000 OS 登录** | 业主告知 | Windows 设置 → 账户 |

如果当前业主已经改过, 接手时让业主告知新密码或者再改一次. **不要把密码写进 git**.

### 5.2 GitHub repo 权限

- 业主账号: `ivanzhao299` (个人 GitHub Pro)
- 接手时业主把仓库 collaborator 加上接手人 GitHub 账号 (Settings → Collaborators)
- 或者业主把仓库 transfer 到接手人 / 团队 GitHub 组织 (彻底移交)

### 5.3 第三方账号

- 阿里云 (域名 / 服务器): `<待填>`
- 诺瓦 NovaLCT 软件 (LED 控制器配置): 装机时集成商配的, 接手要 LCT 数据回包向业主索取
- 集成商 / 设备供应商联系方式: `<待填, 业主补>`

---

## 6. 模块清单 (一行简介)

### 6.1 Backend modules (28)

| 模块 | 作用 |
|---|---|
| **admin-auth** | 后台管理员 scrypt 密码 + 8h token |
| **client-auth** | 业主侧 X-Client-Token, 30 天 TTL, 默认密码 1234 |
| **system-branding** | 系统 logo / 名称 / 欢迎页媒体 ID |
| **brands** | 硬件厂商目录 (NovaStar/DALI/etc, 跟 system-branding 区别开) |
| **devices** | 设备总表 (CRUD) |
| **hardware** | 硬件单元 (网关 / 控制器实例) + driver 选择 |
| **drivers** | driver_template 表 + 自描述接口 + 自助创建 UI |
| **light-zones** | 灯光分区 (业主可见的"前厅/东展区") + 灯组归属; 一个分区含多个 DALI 组, 可跨网关 |
| **power-circuits** | 电源回路 (Sprint G 加, 电流/电压/功率/电量) |
| **lighting** | DALI 灯光控制 endpoint (调用 adapter) |
| **led** | LED 大屏 endpoint (开关 / 切输入 / 欢迎页) |
| **audio** | EKX808 音响 endpoint |
| **hvac** | 空调 endpoint (Modbus-RTU) |
| **playback** | 双路播控通道 (HDMI1 LED / HDMI2 投影) + WS 实时 |
| **media** | 媒体库 (上传 / 列表 / stream) |
| **scenes** | 场景定义 + scene-action 编排 |
| **scene-executions** | 场景执行历史 + 回滚 |
| **scheduler** | 定时触发场景 (e.g. 每天 08:00 自动"开馆") |
| **alerts** | 设备离线告警 + 业主可见红条 |
| **audit** | 审计日志 (driver 模板变更 / 关键操作回滚) |
| **logs** | 通用操作日志 (logs.ps1 可读) |
| **users** | 用户表 (预留, 当前单 admin) |
| **system** | 系统信息 + runtime 状态 (CPU/内存/正常时间) |
| **test-center** | 单设备测试 + Ping + 端口 + raw response |
| **uat** | UAT 验收清单 (每项 pass/fail 记录) |
| **app-release** | APP 在线版本检查 (versionCode / downloadUrl) |
| **websocket** | 全局 ws 网关 (设备状态 + playback 通道 + 告警) |
| **health** | /api/system/info, /api/system/runtime (探活 + 看板) |

### 6.2 硬件 Adapter (5 类)

```
backend/src/adapters/
├── lighting/    (DALI 网关. Mock / Real / cy-dali64a 三种实现)
├── led/         (诺瓦 V2460 VX 协议 + Mock + Real)
├── audio/       (EKX808 HTTP REST)
├── hvac/        (Modbus-RTU HVAC)
├── power/       (Mock + 真实 — 真实接入是 Sprint G2 TODO)
└── transports/  (modbus-tcp.ts + modbus-rtu.ts + tcp-client.ts + http-client.ts)
```

**Adapter 切换**: `.env LIGHTING_ADAPTER_KIND=cy-dali64a` (默认), 改 `mock` 走 Mock 模拟测试.

#### ⚠️ 灯光模型 (2026-07-16 按现场重构, 接手前必读)

现场是**一层 / 7 个分区 / 10 个实测灯组**, 且**一个分区可以由多组灯拼成**
(走廊区就是 4 组). 所以:

```
light_zone  (前厅/东展区/走廊区…)   业主看得见的名字, 前端可增删改
   └── light_group (N 个)          最小可控单位 = (gatewayCode, daliGroup)
                                    唯一键是这个二元组, 不是组号!
```

- **组号在两台网关之间会重复** —— 两台都可能有"组 3", 却是完全不同的灯. 任何
  只拿组号路由的代码都是错的, 必须带 slaveId 一起走
  (`setBrightnessOnGateway(slaveId, group, value)`).
- 分区下发由 `lighting.controller` **扇出**到该区每个组, 串行发 (共用一条
  RS485, 并发帧会互踩), 返回 okCount/failCount.
- 组归属哪个分区, 业主**在前端灯光页「编组」里自己改**, 不用改代码重部署 ——
  网关的 Modbus 寄存器表里没有"组成员"这一项 (查证过), 读不出来, 只能人工核对.
- 实测组分布 (扫组亮度寄存器): 网关#1(拨码1) = 组 5-11, 网关#2(拨码2) = 组 1-3.
  业主说共 11 组, 扫到 10 组, 差的那组现场补一条 light_group 记录即可.

**两个部署坑** (2026-07-16 踩过):
1. **CI 不跑 seed**. `deploy-from-ci.ps1` 只有 install/build/pm2 restart. 新增的
   分区/灯组这类**数据**不会自己上生产, 要手工 `cd backend && node dist/seed/seed.js`
   (winston 在生产写文件不写 stdout, 所以跑完屏幕上什么都没有是正常的, 用 API 验).
2. **`seedHardware` 是 `if (exists) continue`** —— 改 seed 里的硬件字段对**已有**
   生产库无效, 只影响全新安装. 已有记录要走后台硬件清单改.

每个 adapter 都自描述 (driver-descriptor.ts), backend 启动时自动注册到 `driver_template` 表, 后台 `/admin/drivers` 能浏览.

### 6.3 Frontend pages

**业主侧 (`MainLayout`)**:
- DashboardPage — 首页 KPI + 6 场景磁贴 + 子系统状态条
- LightingPage — 楼层 tab + 灯光分区卡 (toggle + 滑条 + 预设)
- LedPage — LED 大屏控制 (开关/切输入/欢迎页) + 双路播控 mirror
- AudioPage — 音响
- HvacPage — 空调
- PowerPage — 电源回路 (Sprint G)
- MediaPage — 媒体库 + 推送
- StatusPage — 系统状态总览
- PlayerPage — Kiosk 全屏播放器 (无业主交互, GK9000 上 Chromium 跑)
- ClientLogin — 业主侧鉴权 + 服务器地址配置

**后台 (`AdminLayout`)** 21 页, 简要分组:
- 监控/告警: MonitorAdmin / AlertsAdmin / AuditAdmin / LogsAdmin
- 设备: DevicesAdmin / HardwareAdmin / DriversAdmin / LightZonesAdmin / PowerCircuitsAdmin / BrandsAdmin
- 场景: ScenesAdmin / SceneActionsAdmin / SceneExecutionsAdmin / SchedulerAdmin
- 测试: TestCenterAdmin / UatAdmin
- 系统: SystemBrandingAdmin / SettingsAdmin / UsersAdmin / AppReleaseAdmin
- 登录: AdminLogin

---

## 7. 部署 / 升级流程

### 7.1 常规升级 (我推 / 推完业主自动拉)

```bash
# 本地开发机 (mac)
git add ...
git commit -m '...'
git push origin main
```

GK9000 上 `auto-update-watcher.ps1` 后台跑, 每 5 分钟一次 git pull, 检测到新 commit 就跑 `update.ps1`. 业主什么都不用做.

### 7.2 强制立刻部署 (从 mac SSH 进去手动跑)

```bash
ssh user@192.168.77.54 'chcp 65001 > $null; cd D:/smart-control; git checkout frontend/components.d.ts 2>$null; git pull --ff-only origin main 2>$null; powershell -ExecutionPolicy Bypass -File .\scripts\update.ps1 -SkipPull -Force'
```

`update.ps1` 干啥:
1. `backup.ps1` 备份 DB + .env
2. git status 检查 (除非 -Force)
3. backend `pnpm install --frozen-lockfile` + `pnpm build`
4. frontend `pnpm install` + `pnpm build` (出 dist/)
5. `pm2 reload smart-control-backend` (或 -Hard 时 restart)
6. `pm2 reload smart-control-frontend` (vite preview)
7. 等 backend `/api/system/info` 返 200 — 健康检查
8. 失败给回滚命令

### 7.3 ⚠️ Components.d.ts 坑

vite-plugin-vue 自动生成, 每次 build 改一行. 我历史上 commit 过, 现在 .gitignore 但 tracked. 拉新 commit 经常冲突. update.ps1 先 `git checkout frontend/components.d.ts` 抛弃本地改动. **千万别手改这个文件**.

### 7.4 Android APP 发版

```bash
# 1. 改 android-app/app/build.gradle.kts 升 versionCode + versionName
# 2. 如果要换 icon: cp 新图到 android-app/icon-source.png 然后跑:
./scripts/generate-android-icons.sh
# 3. commit + push
git push origin main

# 4a. 走 GitHub Actions (推荐, 业主已升 Pro):
#     push 后 .github/workflows/android-build.yml 自动跑, ~3 分钟
#     完成后 gh run download <id> 拿 artifact
gh run watch                  # 等 build 结束
gh run download <run-id>      # 拉 APK
gh release create v1.0.6-android <apk> --title '...' --notes '...'

# 4b. 或本地 build (mac 上, 需 Java 17 + Android SDK):
brew install --cask android-commandlinetools
sdkmanager 'platform-tools' 'build-tools;34.0.0' 'platforms;android-34'
yes | sdkmanager --licenses
cd android-app && ./gradlew assembleDebug --no-daemon
# APK 在 android-app/app/build/outputs/apk/debug/app-debug.apk
gh release create v1.0.6-android android-app/app/build/outputs/apk/debug/app-debug.apk

# 5. 更新后台 AppRelease (业主 APP 看到新版提示)
# 进 /admin/app-release → 高级折叠 → 改 versionCode + downloadUrl 指新 release
# 或 SSH 进 GK9000 跑 sqlite UPDATE (脚本见历史 commit /tmp/update-105.js)
```

⚠️ Maven 镜像 (中国大陆 dl.google.com 慢, 见 `android-app/settings.gradle.kts` 阿里云 mirror 已加)

---

## 8. 日常维护命令

### 8.1 SSH 进 GK9000 后

```powershell
# pm2 状态
pm2 list
# 输出应该有 smart-control-backend (online) + smart-control-frontend (online)

# 重启
pm2 reload smart-control-backend       # graceful (推荐)
pm2 restart smart-control-backend      # hard (会丢 WS 连接)

# 看 backend 日志
pm2 logs smart-control-backend --lines 100
# 或
Get-Content D:/smart-control/logs/backend-out.log -Tail 100

# 备份数据库 (定期或大改前)
.\scripts\backup.ps1
# 输出: D:/smart-control/backups/<日期>.zip

# 还原 (从备份)
Expand-Archive backups/<日期>.zip ./restore-tmp/
Copy-Item restore-tmp/smart-control.db D:/smart-control/database/ -Force
pm2 restart smart-control-backend

# 启动两个 kiosk 播放器 (HDMI1 + HDMI2)
.\scripts\start-players.ps1
# 关掉
.\scripts\stop.ps1
```

### 8.2 改 .env

```powershell
cd D:/smart-control/backend
notepad .env
# 改完
pm2 restart smart-control-backend
```

⚠️ ENV 改了**必须重启** backend (NestJS 读 env 在启动期).

### 8.3 改密码 (业主侧 / 后台)

- 后台密码: 进 `/admin/system-branding` 改密码板块
- 改不了 (忘了原密码): SSH 进 GK9000, 用 better-sqlite3 直接 UPDATE admin_auth_v1 表的 password_hash. 算法: scrypt N=16384, r=8, p=1. 工具函数在 `backend/src/common/utils/password.util.ts`

### 8.4 看 DB

```powershell
# 列所有表
node -e "const db = require('better-sqlite3')('D:/smart-control/database/smart-control.db'); console.log(db.prepare('SELECT name FROM sqlite_master WHERE type=\"table\"').all())"

# 看某张表前 10 行
node -e "const db = require('better-sqlite3')('D:/smart-control/database/smart-control.db'); console.log(db.prepare('SELECT * FROM scene_v1 LIMIT 10').all())"
```

### 8.5 重启全部服务

```powershell
pm2 restart all
# 或
.\scripts\restart.ps1
```

---

## 9. 关键链路 / 易混淆点

### 9.1 双鉴权 (业主 vs 后台)

- 业主侧: `useClientAuthStore`, localStorage `sc.client.token`, 30 天, `X-Client-Token` header
- 后台: `useAdminAuthStore`, sessionStorage `sc.adminToken`, 8h, `Authorization: Bearer` header
- 两者**完全独立**. router/index.ts 里两个 guard 分别管 (注意 `/admin/*` 路径**不走** client-auth guard)

### 9.2 LED 大屏播控

**两条独立路径**:
1. **诺瓦 V2460 内置 preset**: 老路径. backend 发 VX 协议 frame `LoadPreset(N)`, V2460 切到自己内存里的预设画面 (在 NovaLCT 软件里预先做). preset 1 = 欢迎页 (老), preset 2 = 视频...
2. **PlayerPage kiosk 浏览器**: 新路径 (Sprint A 起). GK9000 上 Chromium 全屏窗口 (?slot=1 → HDMI1 → V2460 → LED, ?slot=2 → HDMI2 → 投影). backend `playback.service` 写 `playback_channel_v1` 表 + WS 广播 → PlayerPage 切媒体. 业主在 MediaPage 推什么就播什么.

LED 控制页的 **"欢迎页"按钮** 2026-06-01 后改成:
- 优先看 `system-branding.welcomeMediaId` (业主在媒体库设的)
- 没设回落 V2460 preset

### 9.3 路由表 + WS

backend `/api/playback/channels/:slot/publish` → 写 `playback_channel_v1.currentMediaId` → broadcast WS `playback_channel_changed` event → PlayerPage 监听到就切. LedPage 也监听同一事件, mirror 立即同步.

业主前端 `playbackStore` (Pinia) 也订阅这个 event, slot1/slot2 reactive 全应用通用.

### 9.4 fileUrl 必须 absUrl 拼接

backend 返 `fileUrl: "/api/media/N/file"` 相对路径, 但 frontend 5173 跟 backend 3200 不同端口. **任何 `<video :src>` / `<img :src>` 必须用 `absUrl(path)` 拼**. 走 axios 自动拼 baseURL 没问题, 但浏览器原生 fetch 不走 axios. 见 `frontend/src/services/http.ts`.

### 9.5 ⚠️ 中国大陆 build 网络坑

- Android Gradle 装 AGP 8.5.2 一定从 dl.google.com 慢. 用 `settings.gradle.kts` 里阿里云 mirror.
- npm / pnpm 走 npmmirror 兜底
- GitHub clone 偶尔慢, 必要时走 ssh 而不是 https

---

## 10. 现存问题 / TODO 清单

| 优先级 | 项 | 简述 |
|---|---|---|
| 🔥 高 | **1F DALI 网关连通问题** | L1 TCP 通, L2 Modbus 超时. 现场硬件问题, 让业主有空查 CY-DALI64A LED1/LED2 状态. 见 `docs/DALI_FIELD_INSTALL.md` |
| 🔥 高 | **改默认密码** | admin `jinhu888` / client `1234` 都是默认值, 私库虽然安全但接手人**第一件事就改** |
| 中 | **PlayerPage kiosk 是否在跑** | 业主升级后大屏没显示一般是 Chromium 进程挂了. SSH 进 GK9000 看 `pm2 list` 有没有 `sc-player-1/2`, 没有就 `.\scripts\start-players.ps1` |
| 中 | **Sprint G2 真电表接入** | 当前 power adapter 是 Mock. 现场计划接 DDS866 智能电表, 走 Modbus-RTU. RealPowerAdapter 框架已搭好, 接入只需填寄存器映射 (DDS866 datasheet 业主有) |
| 中 | **DALI 2F 测试灯调试** | Sprint E 把 LightZone 升格成 DB, "全开/全关 没控制到 2F 测试灯"已修, 但具体灯具的 group 编号要核实 |
| 低 | **APK 上架 Google Play / 国内应用市场** | 当前用 debug 签名, 装 APK 系统警告"未知来源". 上架要生产 keystore + signingConfigs |
| 低 | **iOS APP** | 后台 AppRelease 表预留 platform='ios', 但还没写 iOS 壳. 业主当前只 Android |
| 低 | **代码 DEFAULT_PASSWORD 改成首次随机** | 永远不在 git 里写默认密码. 现已要求接手改. 也可改 backend 让首次启动随机 generate + console 打印 + 强制业主第一次登录改 |

---

## 11. 文档索引

按主题分类的 `docs/` 完整列表:

### 架构 + 设计
- **HANDOVER.md** (本文件) ← 你正在看
- DESIGN_SYSTEM.md (v3 蔚来车机风, 709 行)
- architecture/ (子目录, 设计图)
- design-mockups/

### 现场安装
- **EQUIPMENT_LIST.md** — 所有硬件设备清单 / 型号 / 数量
- DALI_FIELD_INSTALL.md — 灯光网关接线 / DALI group / 寄存器
- AUDIO_FIELD_INSTALL.md — 音响接线
- AUDIO_PROTOCOL_EKX808.md — EKX808 REST API
- AUDIO_ARCHITECTURE.md — 音响架构整体
- HVAC_FIELD_INSTALL.md — 空调
- HVAC_ZONES.md — 空调分区
- LIGHTING_DRIVER_DETAILS.md — 灯光 driver 协议细节
- LIGHTING_FINAL_SELECTION.md — 灯光最终选型
- LIGHTING_RECTIFICATION_SPOTLIGHT.md — 射灯整改
- AUDIO_VENDOR_CHECKLIST.md — 音响供应商验收
- WIRELESS_NETWORK.md — 无线网络规划

### 主机 / 部署
- GK9000_FIELD_SETUP.md — GK9000 出厂配置
- GK9000_AUTO_UPDATE.md — watcher 自动更新机制
- HOST_OPERATIONS.md — 主机日常运维
- ONSITE_UPDATE.md — 现场升级 SOP
- TABLET_FULLSCREEN_SETUP.md — 平板 PWA 全屏配置
- Sprint-01-Windows-部署.md — 初次部署清单
- CI_CD.md — CI/CD 流程

### Sprint 交付清单 (历史)
- Sprint-01-交付清单.md ~ Sprint-09-交付清单.md
- SESSION-2026-05-20-RECAP.md — 某次大讨论纪要

### 引用
- references/ (各设备厂商手册, PDF 截图等)
- hardware/ (硬件清单子目录)
- printable/ (可打印版材料)

---

## 12. 接手人 Day 1 步骤

如果你是新接手的工程师, 请按这个顺序:

1. **加 GitHub collaborator 权限**, clone 仓库:
   ```bash
   git clone git@github.com:ivanzhao299/smart-control.git
   cd smart-control
   ```

2. **本地能跑起来** (不接硬件, Mock 模式):
   ```bash
   # backend
   cd backend
   cp .env.example .env       # 改 MOCK_MODE=true
   pnpm install
   pnpm start:dev             # 跑在 :3200
   
   # frontend (另一个 terminal)
   cd frontend
   pnpm install
   pnpm dev                   # 跑在 :5173, 自动开浏览器
   ```
   
   浏览器: `http://localhost:5173/control/` → 看到 dashboard 就 OK

3. **SSH 上 GK9000**, 看实际生产环境:
   ```bash
   ssh user@192.168.77.54
   pm2 list                   # 应该看到 backend + frontend online
   pm2 logs --lines 50        # 看最近日志
   ```

4. **改默认密码** (admin + client), 业主告知后立刻改

5. **跑通一次部署链路**: 在本地改个无害文件 (e.g. 加注释), commit + push, 等 5 分钟 watcher 拉. 或者 SSH 进去手动 `update.ps1`

6. **熟悉模块**: 按 §6 列表浏览 backend/src/modules/, 每个挑一个文件读

7. **熟悉一遍业主交互**: 浏览器打开 GK9000 PWA, 走一遍场景切换 / 灯光控制 / LED 推送 / 媒体上传

8. **读这些文档** (按优先级):
   - DESIGN_SYSTEM.md (前端视觉规范)
   - EQUIPMENT_LIST.md (硬件清单)
   - DALI_FIELD_INSTALL.md (协议细节, 最常出问题)
   - GK9000_AUTO_UPDATE.md (部署机制)

9. **联系业主**, 获取所有 §5.3 第三方账号

---

## 13. 紧急联系 / 升级路径

- **业主**: `<待填 — 业主姓名 + 电话>`
- **业主 GitHub**: `ivanzhao299`
- **原项目维护**: Claude / Anthropic 帮我做的协作 (本文档生成于 2026-06-01)
- **集成商**: `<待填>`
- **诺瓦售后** (LED): `<待填>`
- **音响供应商**: `<待填>`
- **DALI 网关 CY 厂商**: `<待填>`

如果生产环境炸了:
1. SSH 进 GK9000, `pm2 logs --lines 200` 看 backend 日志
2. 看 `D:/smart-control/logs/` 文件日志
3. 试 `pm2 restart all`
4. 还不行 → `scripts/backup.ps1` 截图当前状态, 然后 git revert 到上一个 commit + 重跑 `update.ps1`
5. 数据丢了 → 从 `D:/smart-control/backups/` 找最近一份 zip, 解压回去

---

**文档版本**: 1.0
**生成时间**: 2026-06-01
**最近 git commit**: 217ea37 (feat(welcome): 欢迎页改用媒体库)
**项目状态**: 生产中, 业主使用中, Sprint 1-10 已交付 + v3 视觉重构完成 + Android APK 1.0.5 发布
