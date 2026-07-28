# 项目进展时间线 (PROGRESS)

> 按时间记录项目走到了哪、每个阶段交付了什么。接手人按这条线看完，
> 再读 `docs/INCIDENTS.md`（故障档案）和仓库根 `CLAUDE.md`（工程记忆），
> 就掌握了全貌。历史细节见 `docs/Sprint-0x-交付清单.md` 与 git log。
>
> 最后更新：2026-07-27

## 阶段一：开发交付期（2026-04 ~ 05，Sprint-01~10）

原型 → 后台管理（11 管理页/双鉴权）→ 平板 PWA → 真实设备接入（DALI 灯光 /
LED / EKX-808 音频 / Modbus 空调 / 电源时序器）→ 测试中心 + UAT 验收 →
Windows 生产部署体系（GK9000 工控机, `D:\smart-control\`）。
详见各 Sprint 交付清单；README 中 Sprint 章节属于这个时期的历史资料。

## 阶段二：现场联调期（2026-06 ~ 07 中旬）

- 部署链路成型：push `main` → GitHub Actions → 阿里云跳板(123.57.220.65) →
  WireGuard 隧道(GK9000=10.66.66.3) → `deploy-from-ci.ps1`；盒上
  `auto-update-watcher` 每分钟自动拉取作为兜底（双通道，见 CI_CD.md /
  GK9000_WIREGUARD_CI_DEPLOYMENT.md）。
- 07-15~17：进程管理大整顿——pm2 成唯一属主、verify-deploy.js 成"跑绿"唯一
  判据、boot 任务改 S4U（INCIDENTS #1~4）。
- 07-16：灯光模型按现场重构（`(gatewayCode, daliGroup)` 二元组，INCIDENTS #18）。
- 07-19/20：WireGuard keepalive 根治隧道时断（INCIDENTS #5）。
- 07-23：投影链路定型"模型A"——投影内容由 GK9000 slot2 输出，融合器只做融合显示。
- 07-24：音频输入源与现场接线对齐。
- 07-25：文档投屏（PPT 原生放映/Word 转 PDF 翻页遥控）；生产机构建改
  `build:deploy`（INCIDENTS #11）；孤儿守护把整机拖死事故（INCIDENTS #6）。

## 阶段三：验收整改冲刺（2026-07-26，业主现场逐项验收）

- **生产大修**：前后台全挂事故 → 三段自愈链 + WMI 脱离拉起（INCIDENTS #7/#8）。
- **播控**：LED 断电后大屏显桌面 → relaunch token 机制（#12）；弹窗/任务栏 →
  wscript 静默启动（#13）；LED/投影上传放开更多文件类型；投影卡片双电源
  （seq-5 投影仪 + seq-4 融合器）一开关同控（#17）。
- **音频**：矩阵按现场重接线并核定为基线（#19）；立体声左右声道双推子
  （联动/独立胶囊开关、实时跟手）；输入增益长推子；左右声道测试音频入媒体库。
- **品牌**：logo 换全透明底（待机页/图标白方块问题根治）；Android 图标源同步
  换透明版（APK 发版待做，见"待办"）。
- **情景模式**：首页 4 卡片（开幕/接待/路演/闭馆）按推荐配置重建动作序列，
  点卡片全场馆切换（灯光分组渐变 + 音频路由/静音 + 空调启停 + LED 开关）。
- **欢迎页**：高清动态欢迎页（LED 3612×1462 / 投影幕 6760×2450mm 两版），
  "某某领导"称谓后台可编辑（system-branding.welcomeGuest，20s 轮询生效），
  以内置网页素材形式入媒体库。
- **UI 整改**：空调页顶栏锁定、内机卡片恢复温度显示；投影卡片与 LED 等高。

## 阶段四：运维根治（2026-07-27）

- **pm2 僵尸守护根治**：146 个僵尸 → 证据链定罪部署窗口 CLI 竞态 →
  源头修复 + boot-pm2 每 5 分钟守护去重兜底 → 稳态 2 个（INCIDENTS #9）。
- **部署误报根治**：watcher 抢跑导致的 CI 假红 → 祖先关系容忍（INCIDENTS #10）。
- **可观测性**：verify-deploy.js 探针带完整体检段（进程分类/守护抽样/管道清单/
  boot-pm2.log 尾/计划任务触发器/磁盘/kiosk 心跳/网关/电源回路/音频路由），
  每次 CI 部署自动输出到 Actions 日志——远程排障第一入口。
- **文档整合**：新增本文件与 INCIDENTS.md；CLAUDE.md 工程记忆落 main；
  README 换现状头。

## 阶段五：双端 App 发布链（2026-07-27~28）

- **Android v1.1.3**：CI 固定签名（`android-app/signing/internal.p12`）→ APK 自动
  提交 `deploy/assets/app/` → 随部署链落 GK9000 → 后端 `/api/app/android/download`
  内网直发 + 启动自愈升版本记录 → 终端 App 弹更新。注意：签名切换版，
  终端首次需卸载旧版再装，之后可覆盖升级。
- **iOS v1.1.3 TestFlight 全自动链**（打通记录，共闯五关）：Admin 角色 API 密钥
  （App 管理角色云签名权限不足）→ 归档跳过签名 `CODE_SIGNING_ALLOWED=NO`
  （新账号无注册设备，automatic 归档要 Development 描述文件必死）→
  exportArchive 云签名统一签（signingStyle=automatic）→ **macos-26 跑批机**
  （苹果 2026 起强制 iOS 26 SDK 上传）→ Info.plist 声明
  `ITSAppUsesNonExemptEncryption=false`（免每构建手动答出口合规）。
  构建 #14/#15 已上传成功并挂入内部测试组。
- 鉴权加固：客户端令牌改 HMAC 签名制跨重启存活（INCIDENTS #22）；
  期间因 watcher 不跑迁移引发短暂生产崩溃，已三重根治（自愈补列/迁移幂等/
  update.ps1 补跑迁移）。
- 前端：v6/v6.5 视觉提亮、切页动画去展开感、掉线弹窗防误踢、CI 必红根治
  （INCIDENTS #20~#23）。

## 当前状态与待办

实时状态与进行中任务已收敛到仓库根 **`MEMORY.md`**（会话记忆，随每次工作会话更新）。
本文件只维护阶段性时间线。
