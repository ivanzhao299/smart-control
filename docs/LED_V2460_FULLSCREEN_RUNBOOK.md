# 诺瓦 V2460 LED 全屏运行手册（GK9000 现场）

> 最后核实：2026-09-14。本页是 LED 显示通路的**唯一权威配置**，取代早期文档里的
> VX1000 / 1920×1080 / ViPlex Express / PotPlayer / HDMI1 等过时说法。改动硬件或后端
> LED 逻辑时，先读本页。
>
> **【最高红线 · 绝不许删 / 不得改回旧值】**
> 1. 本文件与 `docs/VIDEO_STREAM_RUNBOOK.md`、生产 `backend/.env` 的 LED_* 配置、
>    `backend/dist/adapters/led/` 协议模块均为现场命脉，任何清理 / `git clean` / 重装都**不得删除**。
> 2. 点对点全屏三相等：**桌面活动分辨率 = V2460 全屏图层 = LED 带载 = 3612×1462**；
>    输入固定 **HDMI2.0(0x90)**、管理地址固定 **192.168.50.30:5200**。**严禁改回**
>    1920×1080、192.168.77.42、HDMI1(0x11)、VX1000、ViPlex/PotPlayer 本地轮播等任何旧值/旧方案。
> 3. 换硬件或改带载时，代码默认值、`.env.example`、生产 `.env`、DB `hardware_unit` 四处必须同步（见 §5.1）。

---

## 1. 显示通路（信号链）

```
运营大屏 PWA 页面 (/control/park-ops/, Edge/Chromium 全屏 Kiosk)
        │  渲染在 GK9000 主显示器
        ▼
GK9000 Intel UHD 显卡  ── 主屏 DISPLAY2（Primary，桌面活动分辨率 3612×1462，与 LED 点对点）
        │  HDMI 线
        ▼
诺瓦 V2460 背板 HDMI 2.0 输入口（VX_SOURCE.HDMI20 = 0x90，卡槽 0x00）
        │  图层1：把输入 1:1 铺满 LED 带载
        ▼
LED 屏体 3612×1462
```

- GK9000 另有一块副屏 DISPLAY1（1280×720，位于主屏右侧，调试用，可空桌面）。
- GPU 时序可能报 3840×2160@29Hz，但**桌面活动分辨率是自定义的 3612×1462**（`[Screen]::AllScreens` / `Win32_OperatingSystem` 以此为准），三者（桌面分辨率 = 图层 = LED 带载）必须一致才是点对点全屏。
- 现场**不再使用** ViPlex Express / PotPlayer 轮播本地视频文件；视频源就是浏览器里的运营大屏页面。

## 2. V2460 权威参数（已多次回读验证）

| 项 | 值 | 说明 |
| --- | --- | --- |
| 型号 | 诺瓦 NovaStar **V2460**（非 VX1000） | 同属 V/VX 协议族，后端协议模块通用 |
| 管理 IP / 端口 | **192.168.50.30 : TCP 5200** | 旧 IP 192.168.77.42 已废弃，只允许出现在历史记录里 |
| 协议帧 | 请求头 `55 AA`，响应头 `AA 55`，校验 = sum(body) + 0x5555 | 见 `backend/src/adapters/led/nova-vx1000-protocol.ts` |
| 输入源 | HDMI 2.0：`VX_SOURCE.HDMI20 = 0x90`，`VX_CARD_SLOT.HDMI20 = 0x00` | 旧 HDMI1=`0x11`/1.3、DVI=`0x00`、SDI=`0x30` 均废弃 |
| 全屏图层 | 图层号 1，width **3612** × height **1462**，startX/Y=0，priority=0，opacity=0x64(100%)，switchOn=true | 即"整屏 1:1" |
| 显示模式 | `VX_DISPLAY_MODE.NORMAL = 0x03` | FREEZE=0x04 / BLACKOUT=0x05 / TEST=0x06 |
| 预设槽 | welcome=槽 1，video/运营大屏=槽 **2** | 全屏配置已 `SavePreset(2)` 固化，设备侧双保险 |

`frameQueryInputResolution` 回包（276B）形如
`... 01 13 00 01 90 00 01 1c 0e b6 05 ...`：源在 `01 13` 后第 4 字节（0x90），
宽 = 其后第 5/6 字节小端（`1c 0e`→0x0e1c=3612），高 = 再后两字节（`b6 05`→0x05b6=1462）。
> 解析偏移易错：以 `i = indexOf(01 13)` 计，source=i+4，width=readUInt16LE(i+7)，height=readUInt16LE(i+9)。

## 3. 后端全屏自愈（NovaLedAdapter）

文件：`backend/src/adapters/led/nova-led.adapter.ts`，编译产物 `backend/dist/adapters/led/nova-led.adapter.js`。

- 后端启动后 `LED_ENSURE_BOOT_DELAY_MS`（默认 **15s**）执行一次 `ensureFullscreenLayer('boot')`，
  之后每 `LED_ENSURE_INTERVAL_MS`（默认 **5min**）幂等执行一次 `'periodic'`；发
  SetLayer(本.cfg 宽×高) → DisplayMode(NORMAL) → 首次成功 SavePreset(video槽)。
- 图层宽高**只来自** `this.cfg.width/height`，而 cfg 来自环境变量
  `LED_RESOLUTION_WIDTH/HEIGHT`（缺省回落到代码默认 3612/1462）。
- host 采用 **DB > env > default**：优先读 `hardware_unit` 表 `code='LED-NOVA-1'` 的 IP
  （正确=192.168.50.30），与当前连接不同才会重建连接并打一条 `rewiring` warn。
- `MOCK_MODE=true` 或 `LED_ENSURE_LAYER=off` 时不自愈；生产必须 `MOCK_MODE=false`。
- 相关环境变量（生产 `D:\smart-control\backend\.env`）：

```ini
LED_HOST=192.168.50.30
LED_PORT=5200
LED_RESOLUTION_WIDTH=3612      # 必须等于 LED 带载宽，错了会被周期自愈反复改成错的
LED_RESOLUTION_HEIGHT=1462     # 同上
LED_PRESET_WELCOME=1
LED_PRESET_VIDEO=2
LED_DEFAULT_BRIGHTNESS_PCT=80
# LED_ENSURE_BOOT_DELAY_MS=15000 / LED_ENSURE_INTERVAL_MS=300000 / LED_ENSURE_LAYER=on
```

> ⚠️ **`.env` 不会被部署覆盖（这是对的），但换硬件/改带载后必须手动同步它**，否则代码默认是新值、
> 生产 `.env` 还是旧值，见 §5 的 2026-09-13 事故。

## 4. 远程恢复全屏（SSH 经跳板，在 GK9000 上跑 node）

远程执行统一入口：`bash scripts/remote-exec/gk9000_exec.sh <本地.py>`。
最小恢复片段（node 直接调编译后的协议模块，**不要手抄 hex**）：

```js
const net = require('net');
const P = require('D:/smart-control/backend/dist/adapters/led/nova-vx1000-protocol.js');
// 依次：图层1整屏 -> NORMAL -> 存预设2 -> 回读
// frameSetLayer({layerNo:1, source:0x90, cardSlot:0x00, width:3612,height:1462,
//                startX:0,startY:0,priority:0,opacity:0x64,switchOn:true})
// frameDisplayMode(P.VX_DISPLAY_MODE.NORMAL); frameSavePreset(2); frameQueryInputResolution()
```

- 看电脑端实际给 V2460 的画面，必须在**交互会话**截图（SSH session0 看不到 console 桌面）：
  用计划任务 `/IT /RL HIGHEST` + `run-hidden.vbs` 在会话内 `CopyFromScreen`（参考 `/tmp/clean_shot.py`）。
- 判断"不全屏"先分层定位：① V2460 图层/输入（回读 0x90/3612×1462？）② 电脑主屏是不是运营大屏页全屏
  （有没有被 PlayerPage 待机页/其它窗口盖住，用 AllScreens 逐屏截）③ HDMI 信号/显卡分辨率。

## 5. 故障史与踩坑（后续开发者必读）

### 5.1 2026-09-13：全屏"恢复几分钟后又坏"反复横跳——根因是 .env 旧分辨率
- 现象：手动/应急把图层发成 3612×1462 后全屏正常，约 5 分钟后又变非全屏，无限循环。
- **根因：生产 `backend/.env`（2026-09-08 老文件）写着 `LED_RESOLUTION_WIDTH=1920/HEIGHT=1080`、
  `LED_HOST=192.168.77.42`。`.env` 优先级高于代码默认，于是后端每 5 分钟的周期自愈"忠实地"
  用 1920×1080 覆盖刚恢复的 3612×1462。自愈机制没错，是它读到的配置过时。**
- 修复：备份 `.env`（`.env.ledfix-时间戳`）后把三行改为 50.30 / 3612 / 1462，
  `pm2 restart smart-control-backend --update-env`，重拉 6 路 HLS，重发全屏并存预设2。
- 验证：新进程不再出现 `rewiring 77.42→50.30`；跨过多个 5min 周期回读始终 0x90/3612×1462。
- 教训：**改 LED 带载/型号时，代码默认值、`.env.example`、生产 `.env`、DB hardware_unit 四处必须一起改。**

### 5.2 FFmpeg 黑色控制台弹窗堆叠
- 根因：`cameras.service.ts` 两处 `spawn('ffmpeg')` 漏写 `windowsHide:true`，Windows 下每路 HLS
  会话弹一个可见黑窗，崩溃重拉叠加。修复 commit `ce7c4c5`（生产已构建生效，黑窗清零）。

### 5.3 watcher 自动更新 × CI Deploy × 人工热修复三方并发停服
- 三把锁不互斥 + `update.ps1` 异常后不兜底拉起，导致 build 互删 dist、端口 EADDRINUSE、前后端 stopped。
- 临时止血：禁用计划任务 `SmartControl-AutoUpdate`，pm2 复活前后端。
- 根治方向（本地脚本已改、待验收后部署）：watcher 与 CI 共用同一把部署锁、拿不到就跳过，
  主流程 try/finally 保证服务最终 online；CI 等锁改为轮询等待而非立即失败。

### 5.4 每周一 00:00 自动重启（预期行为，非故障）
- 计划任务 `\WeeklyReboot` 每周一 00:00 执行，已改为**优雅重启**：由
  `scripts/weekly-graceful-reboot.ps1` 先 `pm2 save`、等待 30s 排空在途请求并落 SQLite WAL，
  再 `Restart-Computer -Force`（任务以 SYSTEM 运行，脚本内显式指向 user 的 PM2_HOME 与 pm2.cmd
  全路径）。用 `scripts/register-weekly-reboot.ps1` 可幂等注册/更新该任务。系统事件 1074 会记录
  本次维护重启，这是按需求配置的维护重启，不是 Windows Update、不是蓝屏断电（后两者对应 41/1001/6008）。
- 重启后靠开机自启自动恢复：`SmartControlBackend`(boot-pm2) → 前后端 → 浏览器 Kiosk →
  后端 15s V2460 自愈 → `SmartControl-PlayerWatchdog` 兜底。**后端启动时会经 `OnApplicationBootstrap`
  延迟错峰自动拉起默认 6 路 HLS**（`HLS_AUTOSTART` / `HLS_AUTOSTART_CHANNELS` / `HLS_AUTOSTART_DELAY_MS`
  等环境变量可配，单路失败不阻塞启动）；前端轮播到视频页仍会按需 POST `/api/cameras/:ch/hls/start`
  （接口幂等），也可手动补拉。

## 6. 一键自检清单

1. `pm2 jlist`：前后端 online；`(Get-Process ffmpeg).Count` 与路数匹配。
2. 回读 V2460 = source 0x90、3612×1462；显示模式 NORMAL。
3. 交互会话逐屏截图：主屏 DISPLAY2 是运营大屏页且铺满，无任务栏/黑边/黑窗/待机页。
4. `backend/.env` 的 LED_HOST/RESOLUTION 与本页一致；`MOCK_MODE=false`。
5. 最近一次开机时间与 `\WeeklyReboot`、事件 1074 对得上，避免把计划重启误判成宕机。
