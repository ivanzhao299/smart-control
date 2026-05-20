# 2026-05-19/20 工作纪要

> 一天的高强度迭代，主线：**Sprint-10 Windows 生产部署 → 上 cnjinhu.top demo → CI/CD → 视觉全面现代化 → 接入金湖品牌 + DALI 灯控 + 硬件清单**。本文按主题归档便于回查。

## TL;DR

| 主题 | 状态 |
| --- | --- |
| Sprint-10 Windows 部署体系 | ✅ 完成 (deploy/ + DEPLOY_WINDOWS.md + PRODUCTION_CHECKLIST.md) |
| cnjinhu.top demo 上线 | ✅ 自动 CI/CD (git push main → 60-90s 上线) |
| 视觉系统现代化 (Sprint-10 UI) | ✅ 主页 + 4 详情页 + 13 后台页全部统一 |
| 金湖品牌切换 | ✅ LOGO + 名称 "金湖展贸中心智能控制系统" |
| DALI 灯光真实硬件接入 | ✅ CY-DALI64A 适配器, 19 路灯 / 12 组 DALI 配置 |
| 硬件清单模块 | ✅ /admin/hardware, 现场 13 台硬件已 seed |
| iPad / Android 平板适配 | ✅ dvh / safe-area / touch-action 全套修复 |

线上：https://cnjinhu.top/control/

## 1. Sprint-10 Windows 现场部署

**commit**: `0d024ca`

**目录**：`deploy/{nginx,scripts,configs,backups,windows-startup}/`

**关键文件**：
- [DEPLOY_WINDOWS.md](../DEPLOY_WINDOWS.md) — 10 节生产部署手册
- [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) — 44 项上线检查
- [WINDOWS_MAINTENANCE.md](../WINDOWS_MAINTENANCE.md) — Tailscale + RDP 运维
- `deploy/nginx/smart-control.conf` — Windows Nginx 反代
- `deploy/scripts/{init,health,restore}.ps1` — 部署 / 健康检测 / 恢复
- `deploy/configs/version.json` — 版本元数据
- `deploy/windows-startup/{README.md,boot.ps1}` — 开机自启 (PM2 + Task Scheduler 双方案)

**后端新 API**：
- `GET /api/system/info` — 含 `version/buildTime/commit/ref/nodeVersion/host/uptimeSec` (commit `81603f4`)
- `POST /api/system/backup` — 在线备份 SQLite
- `POST /api/system/restore` — 恢复模拟接口
- `GET /api/system/backups` — 备份列表

## 2. CI/CD 流水线

**commit**: `c268f78` (workflow) + `9744a1e/b836b18/586afe6/6a91896` (排错系列)

**触发**：push main → CI (前后端 typecheck + build) → Deploy (打包 + scp + ssh + pm2 reload) → Health check → 失败自动回滚 current 软链

**文件**：
- [.github/workflows/ci.yml](../.github/workflows/ci.yml)
- [.github/workflows/deploy.yml](../.github/workflows/deploy.yml)
- [scripts/deploy-backend-remote.sh](../scripts/deploy-backend-remote.sh) — 服务器端后端部署脚本
- [docs/CI_CD.md](CI_CD.md) — 配置指南

**Secrets**：
- `DEPLOY_SSH_KEY` (已配置, 私钥在本地 `~/.ssh/smart_control_deploy`)
- `DEPLOY_HOST` — 已加 fallback `47.236.122.224`，不配也能跑

**踩过的坑**（参考排错）：
1. `webfactory/ssh-agent` 6s 失败 → 改自诊断版本逐项检查 `9744a1e`
2. secret 粘贴尾部多换行 → workflow awk 自动剥空行 `586afe6`
3. **`.gitignore` 的 `logs/` 没加 `/` 前缀，误把 `backend/src/modules/logs/` 整个源码目录 ignore 了** → 锁定到 `/logs/` + `backend/logs/` `6a91896`
4. `/api/system/info` 没暴露 commit 导致难判断线上版本 → `81603f4`

**紧急直推旁路** (CI 挂时)：
```bash
cd ~/projects/smart-control/frontend && pnpm run build
tar czf /tmp/control-dist.tgz -C frontend/dist .
scp -o BindInterface=en0 /tmp/control-dist.tgz root@47.236.122.224:/tmp/
ssh -o BindInterface=en0 root@47.236.122.224 '
  rm -rf /tmp/stage && mkdir /tmp/stage
  tar xzf /tmp/control-dist.tgz -C /tmp/stage
  /srv/www/cnjinhu.top/bin/release.sh control /tmp/stage
'
```

## 3. 金湖品牌切换

**commit**: `423b7f8` (名称) + `779a3be` (LOGO 图) + `a6e95e7` (圆角)

| 改动 | 内容 |
| --- | --- |
| 平板顶部标题 | "展贸中心智能中控" → **"金湖展贸中心智能控制系统"** |
| 后台侧栏 | "中控后台" → "金湖展贸中心 / 后台管理" |
| LOGO | 蓝色 ● → **金湖科创产业园 LOGO 图**（白底圆角投影） |
| index.html title | 同步 |
| PWA manifest name/short_name | 同步 |

**关键文件**：
- `frontend/public/brand-logo.png` ← 用户手动上传的 LOGO 图 (82 KB)
- `frontend/src/components/BrandLogo.vue` — img 优先 / SVG fallback
- `frontend/src/composables/useIcons.ts` — Lucide 图标统一映射

## 4. 视觉系统现代化 (Sprint-10 UI)

**包**：lucide-vue-next ^0.x (按需 tree-shake, +10KB gzip)

**全局抽出的设计 token** (在 `frontend/src/styles/theme.css`)：

| Class | 用途 |
| --- | --- |
| `.sc-head-ico` | 标题左侧 44×44 渐变图标方块 |
| `.sc-title / .sc-subtle` | 标题 + 副标题 |
| `.sc-act + sc-act-{success,danger,warning,primary,purple,neutral}` | 渐变 + 投影的现代操作按钮 |
| `.sc-status + .sc-status-dot + .is-{on,off,warning,error}` | 状态徽章 (脉冲动画) |
| `.sc-toggle` | 选项 / 输入源 toggle 按钮 (蓝紫渐变 active) |
| `.sc-panel` | 大区块容器 |
| `.sc-err` | 错误提示条 |

**主页/详情页改造** (commit `c268f78` + `e28740c`)：
- 平板首页：BrandLogo (SVG → 真实 LOGO)、scene buttons 蓝紫渐变 + 玻璃质感
- LightingPage / LedPage / AudioPage / HvacPage 全用 sc-act 主操作 + sc-status + sc-toggle
- 各页面标题 emoji → Lucide

**后台 13 页全部统一** (commits `604bada` → `f47a972`)：
- Settings (基准) / Monitor / Alerts / Devices / Scenes / SceneActions / Scheduler / SceneExecutions / TestCenter / UAT / Logs / Users / Hardware

**侧栏 emoji → Lucide** (`604bada`)：12 个后台菜单 + 7 个平板菜单
- `ADMIN_NAV_ICON` / `NAV_ICON` 映射在 `useIcons.ts`

## 5. DALI 灯光真实硬件接入

**commit**: `64c7548`

**硬件链路**：
```
中控 (Modbus RTU over TCP)
   ↓
USR-TCP232-410s 转换器  192.168.50.20:502
   ↓ RS-485
CY-DALI64A 网关 (slave_id=1)
   ↓ DALI 总线
5 台 DA4-D 调光器 (4CH × 4 + 3CH × 1 = 19 路输出)
   ↓
19 路灯具回路
```

**新增代码**：
- `backend/src/adapters/transports/modbus-rtu.ts` — Modbus RTU 客户端 (CRC16 + FC 03/06/10)
- `backend/src/adapters/lighting/cy-dali64a-registers.ts` — 寄存器地址 / 值范围工具
- `backend/src/adapters/lighting/cy-dali64a.adapter.ts` — 真实 DALI 适配器
- `LightingAdapter` facade 加 `LIGHTING_ADAPTER_KIND` env (默认 `cy-dali64a` / 备选 `iot-gateway` / `mock`)

**12 个 DALI 组分配** (与现场 19 路灯具对齐)：
| Group | 楼层 | 区域 |
| --- | --- | --- |
| 1-7 | 1F | 前厅/路演/走廊/重点/F102/F103/F104 |
| 8-12 | 2F | 前厅/服务中心/共享办公/产研/指挥 |

**Device.address JSON 约定**：
```json
{"slaveId": 1, "group": 3}    // 控制 1 号网关的组 3
{"slaveId": 1, "short": 17}   // 控制单灯短地址 17
```

**env 配置**：
```
LIGHTING_ADAPTER_KIND=cy-dali64a
DALI_RTU_HOST=192.168.50.20
DALI_RTU_PORT=502
DALI_RTU_SLAVE_ID=1
DALI_RTU_FRAME_INTERVAL_MS=200
DALI_RTU_DEFAULT_FADE_SEC=0.7
```

**协议文档**：[源 PDF](/Users/mac/Desktop/展厅智能集中控制系统开发/硬件接口/元创智控-产品资料（百度云）/单路DALI网关模块资料/线上单路DALI网关模块说明资料250225v1.04.pdf)

## 6. 硬件清单模块

**commit**: `957e0c3`

**目的**：与逻辑 `device` 表解耦的物理硬件清册，给运维 "哪路灯不亮 → 哪台 DA4-D → 哪个电箱" 定位用。

**Entity**: `hardware_units` 表，13 类别 (dali-gateway/dali-dimmer/rtu-tcp-converter/led-*/audio-dsp/hvac-gateway/tablet/...)

**Seed 预填**：13 台金湖现场硬件
- HOST-GK9000 (中控主机, 占美 GK9000 / Win10) × 1
- CONV-RTU-1 (USR-TCP232-410s) × 1
- GW-DALI-1 (CY-DALI64A) × 1
- DIMMER-DA4D-01~05 (CTLEDTECH DA4-D × 5) — 每台 channels JSON 描述 4 个通道接哪些灯
- LED-NOVA-1 / LED-NUC-1
- AUDIO-DSP-1 / HVAC-GW-1 / TABLET-1F

**API**: `GET/POST/PUT/DELETE /api/hardware` + `GET /api/hardware/summary`

**页面**: `/admin/hardware` — 顶部 4 张统计卡 + 13 类 tab 筛选 + JSON 校验编辑

## 7. iPad / Android 平板适配

**commits**: `597a3ef` (iPad Safari) + `02cd01f` (dvh + safe-area) + `efa8f09` (侧栏加大) + `284f892` (1920+ 4 列)

**修了什么**：
1. `<button>` 在 iOS Safari 不响应 → 全局 `button { touch-action: manipulation; -webkit-tap-highlight-color: transparent }` + sc-touch 加 `-webkit-appearance: none`
2. `FullscreenPrompt` mask 在 iPad 永久卡死 → `enter()` 用 `try/finally` 保证关掉 + iOS 直接跳过 prompt
3. **`100vh` 包含 Safari 底部 tab bar 高度** → 三处 layout 加 `height: 100dvh`
4. Home Indicator 顶到按钮 → `padding: env(safe-area-inset-*)`
5. 1920×1200 安卓平板：场景按钮 3 列 → 4 列 (`@media (min-width: 1600px)`)
6. 侧栏按钮加大：宽 116→144, icon 24→30, 字 13→16, 字重 500→600

## 8. 服务器细节 (cnjinhu.top)

| 路径 | 用途 |
| --- | --- |
| `/srv/www/cnjinhu.top/control/current/` | 前端 dist (release.sh 管) |
| `/srv/app/smart-control/current/backend/` | 后端 (CI deploy.yml 切软链) |
| `/srv/data/smart-control/database/smart-control.db` | SQLite (持久, 跨发版保留) |
| `/srv/data/smart-control/backups/` | 备份目录 (env BACKUP_DIR 固化) |
| `/srv/data/smart-control/logs/` | winston 日志 |
| `/srv/www/cnjinhu.top/bin/release.sh` | 通用前端发布脚本 (服务器自带) |
| PM2 进程 | `smart-control-backend` 监听 `127.0.0.1:3200` |
| Nginx | `default` 主配置, `/control/*` 三个 location |

**SSH 连接** (必须带 `-o BindInterface=en0`)：
```bash
ssh -o BindInterface=en0 root@47.236.122.224
```

## 9. 当前未完成 / 已知问题

- ❌ **现场施工未做**: DA4-D 调光器拨码 / DALI 上位机搜索驱动 / 组分配 — 等硬件到位
- ❌ **`MOCK_MODE=false` 切换**: 线上还在 mock，等现场设备能通后才切真实
- ⚠ **scene-action 引用旧设备名**: 12 个新 lighting device (light_1f_lobby 等) 还没替换旧的 light_1f_main / light_2f_main 引用，scene 执行时仍走旧的
- ⚠ **CI/CD 没自动跑 seed**: backend 升级后需手动 `ssh root@... 'cd /srv/app/smart-control/current/backend && npm run seed'` 才会新增 entity 数据

## 10. 常用排查命令

```bash
# 线上当前 commit
curl -s https://cnjinhu.top/control/api/system/info | jq '.data | {commit, buildTime, env}'

# 健康检查
curl -s https://cnjinhu.top/control/api/system/health | jq .data

# 设备列表 + 硬件清单
curl -s 'https://cnjinhu.top/control/api/devices?pageSize=50' | jq '.data.list | length'
curl -s https://cnjinhu.top/control/api/hardware/summary | jq .data

# 触发健康探活
curl -X POST https://cnjinhu.top/control/api/system/runtime/health/probe

# 服务器 PM2 日志
ssh -o BindInterface=en0 root@47.236.122.224 'pm2 logs smart-control-backend --lines 100 --nostream'

# 服务器跑 seed
ssh -o BindInterface=en0 root@47.236.122.224 'cd /srv/app/smart-control/current/backend && npm run seed'
```

## 11. 全部提交清单 (本次会话)

`f47a972` style: Users/UAT/Logs/SceneActions/TestCenter 视觉对齐
`686dd29` style: Scenes/Scheduler/SceneExecutions 视觉对齐
`dd79f17` style: DevicesAdmin 视觉对齐
`242a2b7` style: MonitorAdmin + AlertsAdmin 视觉对齐
`284f892` style: 大屏 1920+ 场景按钮 4 列
`02cd01f` fix: iPad Safari 底部遮挡 + 侧栏不全 (dvh + safe-area)
`ec1b8a2` style: SettingsAdmin 重做 (现代视觉)
`604bada` style: 后台侧栏 emoji → Lucide + 修点击不响应
`957e0c3` feat: 硬件清单模块
`64c7548` feat: CY-DALI64A DALI 网关接入 (Modbus RTU)
`597a3ef` fix: iPad Safari 侧边导航点击无响应
`e28740c` style: 4 个详情页统一现代视觉
`7fa9453` chore: 添加金湖科创 LOGO
`efa8f09` style: 侧边导航加大 (平板触控)
`a6e95e7` style: BrandLogo 圆角 + 白底
`779a3be` chore: 添加金湖 LOGO
`423b7f8` feat: 切换品牌为「金湖展贸中心智能控制系统」
`81603f4` feat: /api/system/info 暴露 commit + ref
`6a91896` fix: .gitignore 'logs/' 误伤源码
`586afe6` fix: SSH key 尾部空行处理
`b836b18` fix: DEPLOY_HOST 加 fallback
`9744a1e` fix: SSH 自诊断
`81562f6` chore: trigger first CI/CD run
`c268f78` feat: GitHub Actions 流水线 + UI 现代化
`0d024ca` feat: Sprint-10 Windows 生产部署
