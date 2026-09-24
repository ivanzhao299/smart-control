# 视频流接入运行手册（GK9000 现场）—— 权威基线

> 最后核实：2026-09-14。本页是 GK9000 现场视频链路的**唯一权威配置**。
> **【最高红线 · 绝不许删 / 不得改回旧值】**
> 1. 本文件、`docs/LED_V2460_FULLSCREEN_RUNBOOK.md`、SQLite `video.binding` 配置及旧 JSON 恢复证据、
>    `D:\video-ai-analyzer\`（主程序 / venv / yolov8n.pt / run_ai_service.bat / ai-watchdog.ps1）
>    都是现场可运行的命脉，**任何清理、`git clean`、重装、迁移都不得删除**，清理临时文件只允许进回收站。
> 2. 摄像头一律走**子码流（海康通道号末两位 `02`，640×360）**，不准改回主码流；NVR 地址、端口转发、
>    6 路绑定关系以本页为准，不准回退到"转码服务/解码服务器/本地视频文件轮播"等已废弃方案。
> 3. 改任何视频相关配置前先读本页；改动后必须本地/现场验收并经同意才部署（见 HANDOVER 铁律）。

---

## 0. 一句话架构

现场有**两条相互独立**的视频链路，别混为一谈：

| 链路 | 源 | 处理 | 消费方 | 进程/端口 |
| --- | --- | --- | --- | --- |
| A. 大屏 6 路实时监控 | 两台海康 NVR 的 RTSP **子码流** | 后端 ffmpeg **HEVC→H.264 转封装成 HLS** | 运营大屏视频页 hls.js | NestJS backend:3200，ffmpeg×12，分片落 `tmp/hls/` |
| B. 人车 AI 分析 | 同两台 NVR 的 3 路 RTSP **子码流** | OpenCV 直连 + YOLOv8n/ByteTrack 推理（**不经过 ffmpeg、不转码**） | 大屏 AI 卡片/检测框 | 独立 Python 服务 :8000 |

> 关键认知：**不需要任何"解码服务器/转码服务/媒体服务器"**。A 链路只用轻量 ffmpeg 把 NVR 子码流
> 转封装成浏览器能播的 HLS；B 链路直接在 Python 里用 OpenCV 拉子码流做推理。昨天能看、今天也应能看，
> 凡是把方案复杂化（额外转码集群、拉主码流、本地 mp4 轮播）的方向都是错的。

---

## 1. 两台 NVR 与端口转发（系统级，持久）

| NVR | 真实内网 IP | 凭据来源 | 经本机 portproxy 转发 |
| --- | --- | --- | --- |
| Port5 录像机（192.168.1.5，主力，5 路来源） | **192.168.1.5:554** | SQLite `video.binding`；禁止在代码/文档记录明文 | `0.0.0.0:5545 → 192.168.1.5:554` |
| Port3 录像机（192.168.1.19，1 路来源） | **192.168.1.19:554** | SQLite `video.binding`；禁止在代码/文档记录明文 | `0.0.0.0:5546 → 192.168.1.19:554` |

- 转发由 Windows **`netsh interface portproxy`** 提供（iphlpsvc 服务，配置持久化在注册表，重启仍在，
  **不是易断的 SSH 隧道**）。查看：`netsh interface portproxy show v4tov4`。
- 后端统一从 SQLite `video.binding` 读取 NVR 地址、端口与凭据；如需走 portproxy，应在后台把地址/端口配置为
  `127.0.0.1:5545/5546`。**AI 服务直接用真实 IP 192.168.1.5 / 192.168.1.19**（见 §4）。
- 排查连通：`Test-NetConnection 192.168.1.5 -Port 554`、`...1.19...`，以及确认 5545/5546 在监听。
- 摄像头总口径：**2 台 64 路 NVR 共 128 路，在线约 125、离线 3，当前接入大屏 6 路、接入 AI 3 路。**

## 2. 大屏 6 路绑定（子码流，绝不许改主码流）

| 通道 id | NVR | 海康通道号 | 子码流 | 大屏显示名（2026-09-13 定稿） |
| --- | --- | --- | --- | --- |
| `d37`  | Port5(1.5) | 3702 | 是 | 北大门（D37） |
| `d57`  | Port5(1.5) | 5702 | 是 | 西大门（D57） |
| `d02`  | Port5(1.5) | 202   | 是 | 东区通道（原"展贸中心"） |
| `p3-d37` | Port3(1.19) | 3702 | 是 | 东大门（P3-D37） |
| `p3-d45` | Port5(1.5) | 4502 | 是 | E 区主通道（原"研发楼 A"） |
| `p3-d50` | Port5(1.5) | 5002 | 是 | 餐厅南（原"研发楼 B"） |

- 海康通道号规则：`xxxx01`=主码流、**`xxxx02`=子码流**。本表全部用 `02`，640×360，省带宽/CPU。
- 绑定唯一事实源是 SQLite `video.binding`（nvrs + channels + displayLayout 3×2）；`VideoBindingService`
  统一提供后台编辑、HLS、截图、AI 下发和兼容别名解析。HLS 对海康 `..01` 通道确定性转换为 `..02` 子码流。

## 3. A 链路：ffmpeg 转封装 HLS（后端 cameras 模块）

源码：`backend/src/modules/cameras/cameras.service.ts`（控制器 `cameras.controller.ts`）。

- RTSP 源：`rtsp://<user>:<urlenc(pass)>@127.0.0.1:<5545|5546>/Streaming/Channels/<hikChannel>`，
  参数 `-rtsp_transport tcp -fflags nobuffer`。
- **为什么要转码**：NVR 输出 **HEVC(H.265)**，浏览器 hls.js 只支持 H.264，所以 ffmpeg 必须转成 H.264；
  因子码流已是 640×360，转码极轻（12 个 ffmpeg 合计约 10% CPU / 12 核）。
- HLS 参数：`-f hls -hls_time 1 -hls_list_size 3 -hls_flags delete_segments+append_list+omit_endlist`，
  分片落 **`D:\smart-control\tmp\hls\<通道id>\*.ts`**（1 秒一片、滚动保留约 3–7 片）。
  > `tmp\hls\` 是**在用运行目录，清理 tmp 时绝不许删除**。
- `spawn(ffmpeg, ..., { windowsHide: true })`：Windows 必须隐藏控制台，否则每路弹黑窗（commit `ce7c4c5` 修复）。
- 生命周期：
  - 启动一路（幂等，已在跑则返回现有会话）：`POST /api/cameras/:ch/hls/start` → 201。
  - 播放地址：`/api/cameras/:ch/hls/playlist.m3u8`，前端 hls.js 拉。
  - 抓图：NVR `ISAPI/Streaming/channels/<ch>/picture`，HTTP **Digest** 鉴权。
  - **后端重启不会自动拉流**：由前端轮播到"重点区域实时监控"页时按需 start，或人工/脚本对 6 路各 POST 一次。
- 健康判据：每路 `tmp\hls\<ch>` 最新 `.ts` 的年龄应在数秒内；`(Get-Process ffmpeg).Count` ≈ 接入路数×2（每路输入+输出进程形态，实测 6 路=12）。

### 3.1 一键补拉 6 路（PowerShell，后端起来后执行）
```powershell
'd37','d57','d02','p3-d37','p3-d45','p3-d50' | ForEach-Object {
  Invoke-RestMethod -Method Post "http://127.0.0.1:3200/api/cameras/$_/hls/start" | Out-Null
}
```

## 4. B 链路：AI 人车分析（独立 Python 服务 :8000）

- 目录：**`D:\video-ai-analyzer\`（绝不许删）**
  - `video_ai_analyzer.py`（主程序，YOLOv8n + ByteTrack，越线计数）
  - `venv\`（**必须用 venv 里的 python**：`venv\Scripts\python.exe`，依赖装在 venv，不是系统 Python）
  - `yolov8n.pt`（最轻量模型 6.5MB）、`run_ai_service.bat`（正式启动脚本，重定向日志）
  - `ai-watchdog.ps1`（守护：:8000 没监听就 Start-ScheduledTask VideoAI-Run）
  - `service.log` / `service-error.log`；改码前的回滚备份 `video_ai_analyzer.py.bak-*` 保留。
- 3 路**子码流直连真实 NVR（不走 portproxy、不经 ffmpeg）**：d37=`3702`、d57=`5702`、
  p3-d37=`3702`。用户名可由 `NVR_PORT5_USERNAME`/`NVR_PORT3_USERNAME` 提供，密码必须通过
  `NVR_PORT5_PASSWORD`/`NVR_PORT3_PASSWORD` 安全注入；禁止写进脚本或文档。
- 接口（FastAPI，绑 0.0.0.0:8000）：`/api/health`、`/api/stats`（各门岗 in/out、车型分类、total.current_*）、
  `/api/detections`（实时检测框）。
- 前端消费：运营大屏 `frontend/public/park-ops/js/app.js` 每 **5s** 拉 `/api/stats` 刷 AI 卡片，
  在视频监控页每 **1s** 拉 `/api/detections` 画框；夜间画面无人车时统计为 0 属正常。
- **CPU 调优（2026-09-14，必须保留）**：`torch.set_num_threads(4)` + 环境变量 OMP/MKL=4、
  `FRAME_SKIP=8`（约 3FPS 推理，门岗慢速目标足够）、`model.track(..., imgsz=320)`。
  调优前整机稳态 88–94%（AI 独占 71%），调优后整机约 46–63%（AI 约 30%），检测功能不变。
  回滚备份：`video_ai_analyzer.py.bak-20260914-003526`。

### 4.1 AI 开机自启 / 守护（2026-09-14 重建，重启不再丢）
- 计划任务 **`VideoAI-Run`**：由任务计划程序**直接托管** `cmd /c run_ai_service.bat`，
  Interactive 用户、`ExecutionTimeLimit=PT0S`（无限）、`MultipleInstances=IgnoreNew`、失败重启 3 次。
  > 不要用"一个 powershell 里 `Start-Process cmd /c bat -WindowStyle Hidden`"的方式拉起——
  > > 父任务结束时子进程会被回收（已实测失败）。必须让任务计划程序直接托管 Run 任务。
- 计划任务 **`VideoAI-Watchdog`**：AtLogon + 每 1 分钟，跑 `ai-watchdog.ps1`，:8000 掉线且 Run 非 Running 就拉起。
- 历史上的一次性任务 `VideoAIService` / `VideoAIAnalyzer`（无 AtStartup、Next 为空）是**重启后 AI 丢失的根因**，
  已被上面的 Run+Watchdog 取代；不要再依赖一次性定时触发。
- 手工控制：`Start-ScheduledTask VideoAI-Run` / `Stop-ScheduledTask VideoAI-Run`；
  改 `video_ai_analyzer.py` 后：停 Run→杀掉残留 analyzer python→再 Start，约 70–90s 后 :8000 上线。

## 5. 现场快速自检

```powershell
# 1) NVR 转发与可达
netsh interface portproxy show v4tov4
Test-NetConnection 192.168.1.5 -Port 554; Test-NetConnection 192.168.1.19 -Port 554
# 2) 6 路 HLS 出片新鲜度（应都在数秒内）+ ffmpeg 数
Get-ChildItem D:\smart-control\tmp\hls -Directory | %{ ($_ | gci *.ts | sort LastWriteTime -desc | select -1) }
(Get-Process ffmpeg).Count
# 3) AI
Invoke-RestMethod http://127.0.0.1:8000/api/health
Get-ScheduledTask VideoAI-Run,VideoAI-Watchdog | ft TaskName,State
# 4) 后端/前端
pm2 status --no-color   # 两个都 online、restart 不增长
```

## 6. 常见坑（后续开发者必读）

1. **黑屏/转圈**：先看 `tmp\hls\<ch>` 有没有持续新增 .ts；没有就 POST 一次 hls/start（后端重启后常需补拉）。
2. **花屏/HEVC 报错**：确认 ffmpeg 带了 H.264 转码参数，没退回"直接转发 HEVC"。
3. **AI :8000 拒绝连接(10061)**：VideoAI-Run 是否 Running、venv python 是否存在、service-error.log；
   开机后没起多为守护问题，用 §4.1 排查，不要重装依赖（venv 是好的）。
4. **CPU 打满**：先按进程归因（AI python / ffmpeg / msedge）；AI 高就确认 §4 的三项降载参数还在，别拉主码流。
5. **凭据错误**：出现 401 时在后台视频绑定或 AI 服务环境变量中核对，禁止把凭据复制到日志、代码或文档。
6. **绝不许删**：`tmp\hls\`、`D:\video-ai-analyzer\`、SQLite 配置、旧 JSON 恢复证据、本手册与 LED 手册。
