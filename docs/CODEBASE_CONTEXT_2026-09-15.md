# 当前代码上下文（2026-09-15）

> 本文记录当前 `main` 的实现边界，供后续开发快速定位。它补充根目录 `MEMORY.md`，不取代现场权威手册：LED 看 `LED_V2460_FULLSCREEN_RUNBOOK.md`，视频与 AI 看 `VIDEO_STREAM_RUNBOOK.md`，部署与数据保护看 `MINIMAL_DEPLOYMENT_RULES.md`、`RUNTIME_DATA_PROTECTION.md`。

## 当前基线

- 本轮开发前 Git 基线：`53de69d`；该提交的 CI 与 GK9000 部署均已成功。
- 当前重点：运营大屏 HLS 生命周期已修复；AI 计数线/ROI 可编辑并热更新；来访照片上墙使用页内相机绕开 iOS PWA 系统相机边界；运行时 JSON 已迁移到仓库外目录。
- 本地数据库、日志、备份和恢复目录可能处于未提交状态；它们是现场数据或恢复证据，后续开发必须保留，不能用清理命令处理。

## 系统分层与代码入口

| 层 | 入口/目录 | 职责 |
| --- | --- | --- |
| 后端 | `backend/src/main.ts`、`app.module.ts` | NestJS API、WebSocket、全局鉴权、SQLite 迁移 |
| 业务控制 | `backend/src/modules/`、`services/` | 设备、场景、媒体、播控、用户、运营大屏 |
| 设备协议 | `backend/src/adapters/` | DALI、V2460、EKX808、HVAC、时序器/断路器、融合器 |
| 前端 | `frontend/src/` | Vue PWA、前台控制、后台、播放器页、独立身份边界 |
| 运营大屏 | `frontend/public/park-ops/` | 静态大屏、HLS、AI 叠加层、三维园区、业务数据编辑 |
| 原生壳 | `android-app/`、`ios-app/` | 地址探测、WebView、更新与原生安全能力 |
| 现场运行 | `scripts/`、`deploy/` | PM2、播放器、备份、GK9000 CI 部署、开机与维护任务 |

## 数据、身份与权限

- SQLite 由 TypeORM 迁移维护；生产禁止 `DB_SYNCHRONIZE=true`。新增实体或变更结构必须提供可审查迁移。
- `users` 的角色分为 `admin`、`operator`、`viewer`；旧客户端令牌是 `legacy` 身份，只可读取共享资源。
- 媒体、播放列表、播放历史及上传配额都带资源归属。普通操作员只能管理自己的私有资料；管理员可管理全部；共享资源的编辑权只属于管理员。
- 前端身份边界在 `frontend/src/services/identity-boundary.ts`：切换账号或服务器必须使旧请求、轮询和延迟回调失效，不能把旧身份结果写回界面。
- 播放器不再复用个人登录：`player-device` 使用按 slot 配发的专用凭据；WebSocket 只推送不含内容的通道失效事件，再由播放器用专用接口获取状态。
- 媒体上传、转码、删除、孤儿导入、配额预留都使用事务与可恢复文件流程。改这部分前先读 `backend/src/modules/media/` 的测试，避免破坏跨用户隔离或磁盘额度原子性。

## 业务链路

- 场景：`SceneEngineService` 排队执行 `scene_actions`，通过 `CommandDispatcherService` 下发到适配器，并记录 `scene_executions`、操作日志与控制总线事件。
- 播控：`PlaybackService` 管理三个通道（LED、投影、背景音乐）；播放、暂停、文档页码/缩放、列表切换均由会话标识防止旧命令覆盖新内容。
- 媒体：普通文件、网页、文档转换、在线音乐与百度网盘导入统一进入 `MediaService`，存储根目录与数据库记录共同决定可读范围。
- 运营大屏：`ops-data-model.mjs` 与 `ops-content.mjs` 是源文件，`ops-content.js` 是生成物。修改源文件后必须运行 `node tools/park-ops/build-content.cjs`，否则 CI 的一致性检查失败。
- 摄像头配置、运营 KPI、翻页状态分别通过 `VideoBindingService`、`ParkOpsMetricsController`、`ParkOpsControlController` 管理。它们是现场运行数据，不是版本化源码。
- 来访照片入口在 `DashboardPage.vue`，页内取景与抓帧在 `WelcomeCameraModal.vue`，上传与欢迎页绑定在 `useWelcomePhoto.ts`。主流程不得重新改回 `<input type="file" capture>`；iOS 主屏幕 PWA 在该系统相机边界存在长期 WebKit 生命周期问题。文件框只用于相册兜底。
- 来访照片物理文件统一放在媒体数据盘的独立目录：GK9000 为 `D:\\Media\\welcome-photos\\<mediaId>\\<filename>`。数据库保存绝对路径，上传临时文件仍在 `D:\\Media\\_tmp`，读取、删除和孤儿扫描均把该目录视为受管媒体，不能手工移动单个编号目录。

## 现场设备事实

- 灯光：分区由多个 `(gatewayCode, daliGroup)` 组成；两台 DALI 网关组号可重复，控制时必须保留 gateway/slave 信息；共享 RS485 要串行下发。
- LED：现场是 NovaStar V2460，输出、图层和带载固定以 **3612×1462** 对齐，输入为 HDMI 2.0。权威参数只认 LED 运行手册，不能依据旧 VX1000、1920×1080 资料改回去。
- 音响：EKX808 是单客户端设备，矩阵读写需串行；BGM 由 Windows 原生守护续播，不能依赖某个前端页面的定时器。
- 视频：6 路子码流经后端 ffmpeg 转 HLS；3 路 AI 由独立 Python 服务直接拉 NVR 子码流。HLS 的创建、重启、子进程回收以及前端 Hls 实例销毁都不能省略。
- 空调：中弘 Modbus 地址由内机配置解析；空调分区批量控制采用错峰与状态回读。
- 电源：EPO-802P 的整机开关必须走设备时序命令，不能把 8 路单开关并发替代；断路器与时序器按硬件类型路由。

## 部署与运行红线

- 唯一生产代码路径：本地提交到 `main` → GitHub Actions → 阿里云跳板/WireGuard → GK9000 的 `deploy-from-ci.ps1`。不要直接改生产仓库文件。
- 部署按静态资源、前端、后端和全量变更分级；无法明确分类的改动视为全量。CI 与部署均成功，才算发布完成。
- 现场运行数据和备份绝不删除。真实 JSON 应位于 `DATA_DIR`（GK9000 为 `D:\\smart-control-runtime\\data`），仓库内 `backend/data/` 只留脱敏模板。跳板机与 Windows 调度器只校验和转发动作，不得清理工作区。版本化部署脚本只隔离目标提交中确实存在的同路径冲突；无关未跟踪文件保持不动，受保护路径冲突则失败关闭。
- 生产部署工作流必须先完成后端全量测试、前端类型检查与双端构建；上线后 `verify-deploy.js` 必须存在并通过。保留最近三个已验证构建快照，禁止把缺少校验器降级成警告。
- PM2 是前后端唯一进程属主。任何 Windows 脚本调用 PM2 都要固定 `PM2_HOME=C:\\Users\\user\\.pm2`；不能从 SSH 会话直接启动播放器，播放器必须走交互会话的 watchdog。
- PowerShell 5.1 文件要遵守编码规则：无 UTF-8 BOM 的 `.ps1` 仅允许 ASCII，否则中文注释可能吞掉下一行代码。
- `RELEASE_HOLD` 是持续发布暂停标记，不代表已经停止所有写入进程。涉及数据库恢复、迁移或生产停写时，必须按受控发布脚本的真实进程核验流程执行。

## 后续开发检查表

1. 先确认需求影响的是业务数据、前端、后端还是现场协议；设备 IP、分区和场景配置优先走后台数据，不把现场值硬编码回源码。
2. 改运行时 JSON 时，同时检查 `DATA_DIR`、保护白名单、备份覆盖和脱敏模板。
3. 改运营大屏时更新静态资源版本号，重建 `ops-content.js`，并检查 HLS 实例是否能被销毁。
4. 改播放器或身份逻辑时，覆盖个人账户、管理员、只读账户和专用播放器四种身份边界。
5. 改 `.ps1`、迁移、部署或设备协议时，先读对应测试与运行手册；这类变更属于高风险全量部署。
