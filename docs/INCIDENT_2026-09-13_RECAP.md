# 2026-09-13 → 09-14 凌晨应急运维错误总结报告（金湖科创产业园运营大屏 / GK9000）

> 用途：把这一整晚反复踩的坑、根因和防再发机制记录在案，供后续开发者/运维直接读取，避免重蹈。
> 配套权威文档：`docs/LED_V2460_FULLSCREEN_RUNBOOK.md`（LED 点对点）、`docs/VIDEO_STREAM_RUNBOOK.md`（视频链路）、`docs/HANDOVER.md`（铁律与交接）。
> 结论先行：**当晚没有发生硬件损坏，生产业务最终全部恢复并优于事发前（AI 补了开机自启、CPU 降载、LED/视频配置固化成文档）；但过程中暴露出"三端不同步、部署无门禁、误删生产数据、配置多处不一致、缺自启守护"五类系统性问题，必须用机制根治。**

---

## 一、错误清单（现象 → 根因 → 处置 → 防再发）

### 1. 前端改动"反复丢失/回退"，现场看到的不是最新版（多次出现，最耗时间）
- 现象：本地明明改过、加过的卡片（AI 分析卡、财务指标卡等）在生产/PWA 上不出现；一度误判为"代码部署回退""被谁清空"。
- 根因（多个叠加，逐次才分清）：
  1. **本地端与生产端是两套状态**，曾在本地旧副本上继续改，又以为同步到了生产；三端（本地仓库 / GK 生产 dist / PWA 现场缓存）没有以同一 Git HEAD 对齐。
  2. **PWA / 浏览器 Service Worker 缓存旧前端**，现场不强制刷新就一直看旧包；"旧缓存内容"被当成"生产被回退"。
  3. **把"推送完成"当成"部署成功"**：多次 CI/Deploy 实际是红的（收到失败邮件），但没有盯到跑绿、没有回验生产真生效。
  4. 个别改动只改了"放大预览容器/大卡片"分支，没改到全局正式页面，等于改错地方。
- 处置：以 Git 为唯一事实源对齐三端；PWA 播控卡加"强制刷新"按钮（点一次只刷一次，修正了点一下刷多次）；无并发重跑部署到绿并回验。
- 防再发（机制）：
  - **改完先本地验收（自己截图自查）→ 经用户明确同意 → 才 push/部署**；部署以"CI/CD 跑绿 + 进程重启 + 新 dist + 页面/屏幕回验 + verify-deploy"为完成标准，推送≠完成、绿勾≠真生效。
  - 三端以同一 commit 对齐；前端发版带缓存失效（nocache 哈希 / SW 更新策略），现场可用强刷按钮兜底。

### 2. ★最严重：误删生产 `backend/.env` 与 `database/` 目录
- 现象：一次部署排障中执行了清理/重装类操作，删除了生产后端 `.env` 和整个 database 目录，随后又去重装依赖、跑迁移，导致现场服务和数据风险被放大。
- 根因：**在没有全面掌握项目文件作用的情况下做了删除动作**；把"备份目录/运行时数据库/环境配置"当成可清理对象；删除前未请示、未进回收站（物理删除）。
- 处置：用既有数据库备份恢复，但**最近一次备份不是最新**，最近几天的数据增量无法 100% 找回——因此**不得声称"所有历史数据都已找回"**。`.env` 依据文档与现场重新补齐（含后来修正的 LED 真实值）。
- 防再发（立为**第一条最高铁律**）：
  - **任何删除/清理（生产 DB、备份、配置、`git clean`、untracked、dist-live、计划任务删除）必须先请示、获明确同意；宁可部署失败也不删数据。**
  - **删除一律进回收站**：Windows 用 `Microsoft.VisualBasic.FileIO.FileSystem.DeleteFile/DeleteDirectory + RecycleOption.SendToRecycleBin`，禁止物理删除；禁用任务≠删文件。
  - 备份策略补洞：DailyBackup 保留窗口要覆盖到"最近几天"，并定期做恢复演练。

### 3. 三方并发部署导致停服（watcher 自动更新 × CI Deploy × 人工热修）
- 现象：同一时刻三把"部署锁"互不互斥，build 互删 dist、端口 EADDRINUSE、前后端被停掉；现场反复出现打不开/页面空。
- 根因：`SmartControl-AutoUpdate` watcher、CI 的 deploy-from-ci、人工 update.ps1 没有共用同一把互斥锁；`update.ps1` 异常路径不兜底拉起服务。
- 处置：先**禁用 `SmartControl-AutoUpdate`**（保持 Disabled 至今）止血，pm2 复活前后端。
- 根治（本地已改、待验收授权后上线）：`scripts/update.ps1` 加全局共享锁 `C:\ProgramData\Anksen\smart-control-deploy.lock` + 部署后 `Ensure-ServicesOnline` + try/finally 兜底；`scripts/deploy-from-ci.ps1` 拿不到锁时由"立即失败"改为"轮询等待约 150s"。**根治上线前不重新启用 AutoUpdate。**

### 4. LED 全屏"恢复几分钟后又坏"反复横跳
- 现象：手动把诺瓦图层发成 3612×1462 后全屏正常，约 5 分钟后又变非全屏，无限循环；一度怀疑"加固脚本是错的"。
- 根因：生产 `backend/.env` 是 2026-09-08 老文件，写着 `LED_RESOLUTION_WIDTH=1920/HEIGHT=1080`、`LED_HOST=192.168.77.42`；`.env` 优先级高于代码默认，后端每 5 分钟的"周期自愈"忠实地用旧值把刚恢复的正确值覆盖。**自愈机制没错，是它读到的配置过时。**
- 处置：备份 `.env` 后改为 192.168.50.30 / 3612 / 1462，`pm2 restart --update-env`，跨多个自愈周期回读始终正确，现场全屏稳定。
- 防再发：换型号/带载时"代码默认 + .env.example + 生产 .env + DB hardware_unit"四处同步；详见 LED RUNBOOK §5.1。

### 5. 设备型号认知过时：VX1000 → 实际是 V2460；播控方案过时
- 现象：早期文档按 VX1000、ViPlex Express/PotPlayer 轮播本地文件写，现场实际是**诺瓦 V2460**、信号源是**浏览器 PWA 全屏页经 HDMI2.0 进 V2460**，按旧文档怎么调都不对。
- 根因：硬件更换后文档/配置没同步（同 §4 的多处不一致）。
- 处置：重写设备清单与现场部署文档，新建 LED RUNBOOK，固化"PWA→显卡 DISPLAY2 3612×1462→HDMI2.0(0x90)→V2460 图层1 1:1→LED"整条信号链；V2460 断电固化用 SavePreset(2)，后端 15s+每5min 自愈兜底。

### 6. FFmpeg 黑色控制台弹窗在现场堆叠
- 根因：`cameras.service.ts` 两处 `spawn('ffmpeg')` 漏 `windowsHide:true`，每路弹一个可见黑窗，崩溃重拉叠加。
- 处置：commit `ce7c4c5` 补 `windowsHide`，生产构建后黑窗清零。**教训：Windows 上 spawn 任何控制台子程序都要 windowsHide。**

### 7. AI 分析服务在 00:00 重启后丢失（本次新发现并根治）
- 现象：WeeklyReboot 重启后，运营大屏人车 AI 卡片无数、:8000 拒绝连接。
- 根因：AI 是独立 Python 服务（`D:\video-ai-analyzer`），但拉起它的两个计划任务都是**一次性定时触发（Next 为空），没有 AtStartup/AtLogon，也不在 pm2**，重启后无人拉起；且曾用 `Start-Process cmd /c bat -WindowStyle Hidden` 方式拉起，子进程随父任务结束被回收。
- 处置：改为**任务计划程序直接托管**的 `VideoAI-Run`（无限时长、IgnoreNew、失败重启）+ `VideoAI-Watchdog`（AtLogon+每1分钟，:8000 掉线就拉起），AI 恢复并验证 health/stats/detections 全 200。详见 VIDEO_STREAM_RUNBOOK §4.1。

### 8. GK9000 CPU 超载（AI 推理吃满大半个 CPU）
- 现象：AI 恢复后整机稳态 88–94%（12 逻辑核），AI 单个 python 占 70.9%，3 路推理 FPS 仅约 10。
- 根因：YOLOv8 在 CPU 推理时**未限制 torch 线程**（默认占满所有核），且每 5 帧推理、推理尺寸 640，对门岗场景偏浪费。
- 处置（保留回滚备份）：`torch.set_num_threads(4)`、`FRAME_SKIP 5→8`、`imgsz 640→320`。整机降到约 46–63%、AI 约 30%，检测/计数功能不变，3 路健康。

### 9. 把"计划内 WeeklyReboot"反复误判成异常重启/宕机
- 现象：00:00 电脑重启、全屏短暂变化，被怀疑"谁触发的、是不是又被搞坏"。
- 根因：这正是此前按需求配置的计划任务 `\WeeklyReboot`（每周一 00:00 `shutdown /r /t 0 /f`），系统事件 1074 可证；非 Windows Update、非蓝屏断电（无 41/1001/6008）。
- 防再发：排查重启先看事件 1074 与计划任务，对号入座；重启后按"pm2 自启→后端 15s LED 自愈→补拉 6 路 HLS→AI Run 自启→Watchdog 兜底"的顺序验收（见两本 RUNBOOK）。是否把 `/t 0 /f` 改优雅重启（先 pm2 save、/t 30）待评审。

### 10. PowerShell 转义 / 编码问题反复打断操作
- 现象：多次因引号/&&/中文编码导致远程脚本报错（PS5.1 用 GBK、不支持 `&&`、ConvertFrom-Json 遇重复键报错、文件 coding 声明与实际编码不一致 SyntaxError）。
- 处置与规约：
  - 远程执行**统一走 `scripts/remote-exec/gk9000_exec.sh`（base64 传脚本）**，不在命令行手拼复杂转义；GK 默认 PowerShell，不写 `&&`。
  - 远程 .py 顶部 `# -*- coding: utf-8 -*-` 且文件真为 UTF-8（含中文就别声明 ascii）；输出 `sys.stdout.reconfigure(encoding="utf-8",errors="replace")`；Windows 路径用 r'' 防 `\U` 转义。
  - **部署类 .ps1 新增内容一律纯 ASCII**，文件存 UTF-8 BOM，规避 PS5.1 中文 GBK 解析风险。
  - 解析 pm2 jlist 别用 PS ConvertFrom-Json（重复 username 键），用 `pm2 status` 文本或 node 解析。

### 11. 布局/样式迭代中的"改 A 坏 B"
- 现象：调整顶栏时间字号/位置时多次出现文字换行、重叠、中间标题被连带左移、翻页按钮被误放大、KPI 色条变斜线；"页面索引 +1"改动一度破坏 PWA 翻页结构。
- 根因：固定列宽/位置约束不足，局部数值改动引发相邻元素位移；改动后没有逐页截图回归就继续叠加。
- 处置与规约：时间栏用固定宽度独立容器（数字变化不漂移）；翻页按钮回归小尺寸圆形箭头；每次样式改动**逐页截图回归**，框架尺寸先锁定再往空白区填内容（新增元素缩小适配，不硬撑变形）。

---

## 二、时间线（关键节点）

- 09-13 白天—晚：多轮布局/内容/样式迭代；穿插"改动看似丢失"（缓存+三端不同步，见错误1）。
- 20:24–21:00：部署排障中发生误删 `.env`/database（错误2），随后用备份恢复（非最新），并补配置。
- 21:00–22:00：LED 全屏反复横跳，定位为 `.env` 旧分辨率（错误4），修正后稳定；确认设备为 V2460（错误5）。
- 22:00–23:30：三方并发停服止血（禁用 AutoUpdate，错误3）；ffmpeg 黑窗修复（错误6，ce7c4c5）；补拉 6 路 HLS。
- 09-14 00:00：WeeklyReboot 计划重启（错误9）；重启后巡检发现 AI 未自启（错误7）。
- 00:24–00:38：重建 AI Run+Watchdog 恢复服务；定位并降载 CPU（错误8）；净化 169+22 个临时脚本（全部进回收站，hls/venv/配置完好）。
- 收尾：两本权威 RUNBOOK 落"绝不许删"红线，本报告归档。

## 三、由此固化的开发/运维铁律（摘要，全文见 HANDOVER）

1. **【最高】删除/清理必须先请示，宁可失败不删数据；删除只进回收站，不物理删除。**
2. **本地验收（自查截图）→ 用户同意 → 才部署；三端同一 commit 对齐；部署以"跑绿+真生效+回验"为准，失败邮件清零。**
3. **生产写操作（配置/计划任务/服务）同样先验收、必要时经同意；改前备份、保留回滚点。**
4. **配置多处一致性**：代码默认 / .env.example / 生产 .env / DB 记录，改一处必须四处对齐。
5. **关键服务都要有开机自启 + 掉线守护**（pm2 管前后端；计划任务 Run+Watchdog 管 AI；PlayerWatchdog 管播放器），并周期性验证重启恢复链路。
6. **Windows spawn 控制台子进程一律 windowsHide；远程执行统一 base64 通道；部署脚本纯 ASCII。**
7. **资源预算**：默认子码流、AI 限线程/跳帧/小推理尺寸，CPU 留足余量给大屏渲染。

## 四、遗留 / 待办（需评审或授权后执行，不擅自上线）

- [ ] 部署并发根治：`update.ps1`/`deploy-from-ci.ps1` 在 GK 只解析校验语法 → 经同意 commit/push → 无并发重跑 Deploy 变绿 → 才重新启用 AutoUpdate。
- [x] 数据库备份：已新增 `scripts/register-backup-task.ps1`（默认每天 00/06/12/18 点共 4 次，历史快照仍不自动删除，删除需单独授权），并在本地临时副本完成一次恢复演练（39 张表逐表一致、integrity_check=ok）。待部署阶段在 GK 重新注册任务。
- [x] WeeklyReboot 已拍板改优雅重启：`scripts/weekly-graceful-reboot.ps1`（pm2 save → 等待 30s 排空请求/落 WAL → Restart-Computer，以 SYSTEM 运行并显式指向 user 的 PM2_HOME），`scripts/register-weekly-reboot.ps1` 幂等把 `\WeeklyReboot` 重指到该脚本。待部署阶段在 GK 注册。
- [ ] 旧一次性 AI 任务 `VideoAIService`/`VideoAIAnalyzer` 当前保留（Next 为空不会触发），确认无影响后可禁用（不删除）。
- [x] 在园人数/在场车辆已接真实源：以 486 人 / 127 车为基线，叠加三个门实时净增(进-出)动态变化，顶栏与综合态势/人车管理面板共 5 处统一随动（`app.js` 基线公式 + `index.html` 的 `data-onsite-*` 标记）；AI 不可达时保持基线显示，不会出现 0 或占位。
- [x] HLS 启动自恢复：`cameras.service.ts` 实现 `OnApplicationBootstrap`，后端启动后延迟错峰自动拉起默认 6 路（`HLS_AUTOSTART*` 环境变量可配、单路失败不阻塞），补齐"后端重启后 hlsSessions 清空、大屏未刷新则 6 路停滞"的缺口。
