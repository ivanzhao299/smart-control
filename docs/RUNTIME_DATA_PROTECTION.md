# 运行时数据保护规约（Runtime Data Protection）

> 2026-09-15 立。起因：生产端在 PWA 改顶部 KPI 点保存后被重置、AI 视频分析的计数线/ROI 框编辑后变回默认一条竖线。
> 根因不是"没保存"，而是**运行时数据写在了 git 仓库工作区内，被部署流程当未跟踪文件删除 / 被 git merge 覆盖**。
> 本文件是这类数据的存放、部署保护、备份与恢复的唯一权威说明，**绝不许删除现场运行时数据与备份**。

## 1. 什么是"运行时数据"

现场运行过程中由用户/系统写入、每次部署都必须原样保留的数据。视频绑定域已收敛到 SQLite，旧文件只读归档：

| 文件 | 内容 | 后端读写点 |
| --- | --- | --- |
| SQLite `video.binding` | NVR/通道绑定、AI 开关、**计数线 countLine、检测区域 roiPolygon**、分屏布局 | `RuntimeConfigStore` + `cameras/video-binding.service.ts` |
| `video-binding.json(.bak)` | 已执行迁移与恢复对账证据；迁移后禁止写入 | 仅历史迁移读取；应用启动不读取 |
| SQLite `park.ops.metrics` | 运营大屏顶部 KPI / 业务数字文档（PWA“运营数据”保存） | `RuntimeConfigStore` + `cameras/park-ops-metrics.service.ts` |
| `park-ops-metrics.json(.bak)` | 已执行迁移与恢复对账证据；迁移后禁止写入 | 仅历史迁移读取；应用启动不读取 |
| SQLite `park.ops.visual` | 园区大屏分区、楼栋、文字与坐标布局 | `RuntimeConfigStore` + `system-branding/system-branding.service.ts` |
| `system_branding_v2.parkOpsConfigJson` | 园区布局首次迁移前快照；迁移后禁止写入 | 仅迁移读取和恢复对账 |
| `ParkOpsControlService` 进程内状态 | 大屏页码、自动轮播和一次性刷新指令；重启恢复安全默认值 | `cameras/park-ops-control.service.ts` |
| `database/smart-control.db` | 主数据库（含视频绑定文档、修订历史和拍照上屏照片的元数据引用） | TypeORM |
| `release.json` | 已验证发布的提交、分支与发布时间；可重建运行证据，不是业务配置 | 仅 `deploy-from-ci.ps1` 在权威验证后原子写入 |

> 新增或改造的设备配置统一进入版本化数据库配置仓储。剩余 JSON 是有期限的只读迁移源，不再作为长期架构扩展；可重建控制信号留在内存，不伪装成持久数据。

## 2. 存放位置：必须在 git 仓库之外

只读保留的旧迁移文件统一按以下优先级解析目录：

1. 环境变量 `DATA_DIR`（最高优先级）；
2. Windows 现场固定：`D:\smart-control-runtime\data`（由 `deploy/ecosystem.config.js` 注入）；
3. 其它平台回退：仓库内 `.runtime/data`（已在 `.gitignore`）。

- 仓库内 `backend/data/` 只保留脱敏模板 `*.example.json`，**整个目录被 `.gitignore` 忽略、不再 git 跟踪**。
- `backend/.env` 若设置 `DATA_DIR`，其优先级高于 pm2 ecosystem，二者必须指向同一目录（现场 `.env.example.windows` 已显式给出 `DATA_DIR=D:\smart-control-runtime\data`）。

## 3. 部署如何保护（scripts/deploy-from-ci.ps1）

每次部署，无论 staticOnly / frontendOnly / backendOnly / FULL：

1. **merge 前抢救**：把仓库内旧位置 `backend/data/*.json` 复制到仓库外 `DATA_DIR`（只复制、不删源；目标已存在则不覆盖现场更新值）。这一步必须在 `git merge` 之前，因为 `video-binding.json` 已从仓库移除，ff-merge 会删掉仓库内副本。
2. **未跟踪文件白名单**：清理 `??` 文件时，凡匹配 `backend/data/`、`.runtime/`、`database/`、`backups/` 或 `*.db/.db-wal/.db-shm/.sqlite/.bak` 的路径**一律跳过、只记录日志，永不删除**。
3. **merge 后兜底迁移**：仍缺的运行时文件再补复制一次。
4. **统一只走 CI**：公共路径幂等 `Disable-ScheduledTask SmartControl-AutoUpdate` 并结束 `auto-update-watcher` 进程，杜绝 watcher×CI 双路并发把现场配置冲回旧值。

## 4. 备份与恢复（scripts/backup.ps1）

每次发布前的 verified 备份，除 SQLite 在线备份、`.env`、UAT 快照外，**额外把 `DATA_DIR`（及旧 `backend/data` 兜底）整体复制进快照的 `runtime-data/`（旧位置为 `legacy-backend-data/`）**，去重、目录缺失自动跳过。

- 备份根：`BACKUP_DIR` > `D:\smart-control-backups` > 仓库内 `backups/`。
- 手动恢复必须按同一发布快照配套恢复 SQLite、媒体与 `runtime-data`，再启动准确代码版本；不得只恢复旧
  `video-binding.json` 覆盖数据库中的新修订。
- 数据库恢复走 `backend/scripts/verified-sqlite-backup.cjs` 的配套流程，先备份当前库再覆盖，并核对
  `runtime_config_documents` 与 `runtime_config_revisions`。

## 5. 以后新增"现场可写文件"的规约（必须同时做）

1. 新配置域优先接入 `RuntimeConfigStore`；确需文件的二进制/大对象才使用数据盘路径，禁止另建 JSON 数据库；
2. 在 `deploy-from-ci.ps1` 的 `$runtimeFileNames` 与白名单 `Test-ProtectedRuntime` 里登记；
3. 在 `backup.ps1` 的运行时目录备份中能被覆盖到（默认整目录复制，一般无需改）；
4. 提供脱敏 `*.example.json` 模板，真实文件保持被 `.gitignore` 忽略、不被 git 跟踪；
5. 不允许任何脚本/流程在未请示的情况下删除运行时数据或备份（见 `INCIDENTS.md` 09-13/09-15 铁律）。

## 6. 2026-09-15 事故复盘摘要

- 现象：KPI 保存后回退默认；AI 计数线/ROI 编辑后变回默认竖线。
- KPI 路径：`park-ops-metrics.json` 未跟踪，被部署脚本"删除全部未跟踪文件"清掉，后端读不到→前端回退内置默认。
- AI 路径：`video-binding.json` 早年被 git 跟踪，`.gitignore` 对已跟踪文件无效；`git merge/reset` 用仓库 HEAD 旧版覆盖现场写入，AutoUpdate 每 90s 再冲一次。
- 根治：数据移出仓库到 `D:\smart-control-runtime\data` + 取消 git 跟踪（留脱敏模板）+ 部署白名单与 merge 前抢救 + 纳入 verified 备份 + 停用 AutoUpdate 统一走 CI。
- 无法自动补回：被覆盖前的最新 AI ROI 现场值无磁盘副本，需在"后台-视频绑定"重画一次（根治后不再丢）；KPI 只能恢复到最近备份口径后由运营在 PWA 补填。

## 7. 2026-09-16 视频绑定收敛

- 迁移 `ImportVideoBindingRuntimeConfig1789560000000` 在目标键不存在时读取主文件，主文件无效再校验 `.bak`；发现文件但均无效时整项迁移失败。
- 当前值与修订 1 在同一 SQLite 事务中写入，带 SHA-256、来源和修订号；服务重启后只读数据库，旧 JSON 后续变化不会回灌。
- 后台编辑、HLS、截图、AI 热下发和展示读取均通过 `VideoBindingService`；`CamerasService` 不再维护第二套 NVR 密码和通道表。
- 旧 JSON 不删除、不改写，继续随发布恢复包归档，用于审计和灾难恢复对账。

## 8. 2026-09-16 运营指标与大屏控制收敛

- 运营指标已经导入 SQLite `park.ops.metrics`，后台更新只产生数据库修订；旧 JSON 只读保留。
- 大屏页码、自动播放与刷新属于可重建控制信号，统一由进程内 `ParkOpsControlService` 管理；生产部署前后均确认 `park-ops-control.json(.bak)` 不存在。
- 大屏轮询 GET 保持公开以服务无人值守页面；PWA 的翻页、自动播放、刷新和拍照回首页统一走共享鉴权客户端，匿名写请求返回 401。

## 9. 2026-09-17 园区大屏视觉布局与品牌启动写入收敛

- 迁移 `ImportParkOpsVisualRuntimeConfig1789580000000` 只在 `park.ops.visual` 不存在时读取品牌表旧字段，严格校验后在同一事务建立当前文档和不可变修订；旧字段损坏会停止迁移，已有版本文档永不被覆盖。
- `system_branding_v2.parkOpsConfigJson` 保留为只读恢复快照。应用读写只走 `RuntimeConfigStore`，保存相同文档不制造修订，真实变更递增 revision 并记录 SHA-256、操作者和来源。
- 编辑器加载时记录 revision，保存时提交期望版本；过期页面收到 409 并要求刷新，避免覆盖另一位管理员的新布局。旧客户端直接提交文档仍可兼容。
- 品牌默认行由迁移幂等建立，服务启动不再读取仓库 Logo、覆盖数据库 Logo 或写 `branding-logo-transparent.done`；生产现有 Logo 和历史哨兵均未删除。

## 10. 2026-09-17 旧 JSON 启动回退退役

- `VideoBindingService` 和 `ParkOpsMetricsService` 启动时只读 `RuntimeConfigStore`，不再探测或解析旧 JSON；旧文件损坏、变化或被恢复均不能覆盖 SQLite。
- `EnsureVideoBindingRuntimeConfig1789590000000` 只为没有导入文件且没有权威文档的新库建立固定时间戳的默认 revision 1；目标键已存在时严格不写。视频文档异常缺失会阻止应用启动，避免以静默默认值掩盖迁移故障。
- 生产第 31 个迁移执行前后三份配置的 revision、历史条数和 SHA-256 全部不变。旧 JSON 继续随恢复包保留，但仅用于离线审计和配套恢复，不是应用回退源。

## 11. 2026-09-17 场景动作启动覆盖退役

- `scenes` 与 `scene_actions` 是场景定义和动作的唯一权威来源；应用启动只读取关系表，不允许依据仓库常量或本地哨兵覆盖管理员修改。
- 已删除 `ScenesService` 的启动修复器。旧逻辑会在哨兵丢失时删除四个推荐场景的全部动作再重建，哨兵与数据库不在同一事务和备份边界，存在恢复或部署后误覆盖风险。
- `D:\smart-control\logs\scene-actions-v2.done` 保留为历史审计证据，应用不再读取或写入它；删除、恢复或修改该文件均不会改变数据库。
- 新安装推荐场景与动作冻结在 `EstablishOperationalCatalog1789660000000` 的不可变目录快照中：迁移只为空动作场景建立推荐动作，已有任意动作即完整保留。部署 seed 已删除；后续升级场景模板必须新增显式版本化迁移或由管理员操作。
- 生产发布前后四个场景共 142 个动作的规范化 SHA-256 完全一致；数据库 31 个迁移、完整性 `ok`、外键违规 0。发布前快照位于 `D:\smart-control-backups\20260917-011550\sqlite-urufJS\database.sqlite`。

## 12. 2026-09-17 电源回路启动写入退役

- `power_circuit` 是电源回路名称、网关、通道和额定参数的唯一权威源；`PowerCircuitsService` 启动只读，不再按固定编码补行或把后台配置改回常量。
- `EstablishPowerCircuitDefaults1789600000000` 仅在整表为空时建立 14 条新安装默认回路。表内已有任何权威记录时不补缺失编码，避免重新创建管理员明确删除的回路。
- 历史修复被限制为可审计的精确签名：LED 只匹配 `RELAY-1F-1` 第 4 路旧配置；时序器只匹配 `seq-4=5` 与 `seq-5=4` 同时成立的旧对调。其他人工通道和值全部保留。
- 有任何电源回路时迁移拒绝无归档降级。生产迁移前两个修复条件均不成立，第 32 个迁移只增加账本；14 条回路逐字段 SHA-256 保持 `72d65fe09ab81f5280879a433225301fc5e0425b4f4d8c98d732ac4cb56bd61d`。
- 发布前快照位于 `D:\smart-control-backups\20260917-013621\sqlite-dcXP3V\database.sqlite`，配套恢复包和回执位于 `D:\smart-control-backups\migration-recovery\release-nvnwgD`。

## 13. 2026-09-17 内置驱动目录启动写入退役

- `driver_templates` 是驱动展示名、厂商、协议、能力和参数表单的唯一权威目录；`DriverRegistryService` 启动只读，不再覆盖内置模板的字段、启用状态或更新时间。
- `EstablishBuiltinDriverTemplates1789610000000` 保存八条内置目录的不可变快照，只插入不存在的 kind。已有同名模板即使被现场定制或禁用也完整保留，非内置模板不受影响。
- 各 adapter 内重复的 `static describe()` 已删除，避免代码常量与数据库形成两份会漂移的元数据。新增驱动或调整目录时必须新增显式迁移，不能恢复启动同步。
- 有任何内置目录时迁移拒绝无归档降级。生产升级只增加第 33 条迁移账本；发布前快照与生产 8 条目录逐字段 SHA-256 均为 `51af7d60c4404318768f96b691aeaa418300b45490b52d5a93b6e6bed92e1960`。
- 发布前快照位于 `D:\smart-control-backups\20260917-020733\sqlite-FgmwGb\database.sqlite`，配套恢复包和回执位于 `D:\smart-control-backups\migration-recovery\release-q7WJ1S`。

## 14. 2026-09-17 品牌目录启动派生写入退役

- `brands` 是硬件和驱动厂商名称、展示资料、联系信息与启用状态的唯一权威目录；`BrandsService` 启动只读，不再扫描引用表后写入缺失品牌。
- `EstablishBrandCatalog1789620000000` 保存十二条产品品牌快照，并从迁移当时的 `hardware_units`、`driver_templates` 补齐其他已引用厂商；只插入不存在的名称，已有品牌的全部字段逐字节保留。
- 新增硬件、修改硬件厂商或新增自定义驱动时，同一业务操作即时调用 `ensureReferenced`。该写入用单条条件插入规避先查后写竞态，不覆盖管理员维护的 Logo、联系方式、备注和禁用状态。
- 有任何权威品牌时迁移拒绝无归档降级。生产升级只增加第 34 条迁移账本；12 条品牌语义 SHA-256 在备份和生产均为 `58bd22ed134e119565623ae4c5fcb27943fd5b2ee7eb37254a29180ce794d036`，所有硬件/驱动厂商引用均能解析到品牌。
- 发布前快照位于 `D:\smart-control-backups\20260917-022829\sqlite-feijSH\database.sqlite`，配套恢复包和回执位于 `D:\smart-control-backups\migration-recovery\release-RT80Vp`。

## 15. 2026-09-17 音频配置启动重建退役

- `audio_output_zone`、`audio_input_source`、`audio_scene` 和 `audio_desired_link` 分别是输出、输入、场景和 8×8 期望路由的唯一权威源；`AudioConfigService` 启动只读。
- `EstablishAudioConfigCatalog1789630000000` 只在对应表为空时建立全新安装默认值。现有非空域不会补缺失通道，避免重建管理员明确删除或调整的数据。
- 2026-07-26 接线修复只在 IN1 名称精确等于旧签名“中控主机”时执行一次；立体声历史修复也只在迁移中执行一次。此后管理员修改 OUT1-4 名称时，在同一事务规范“·左/·右”并同步另一声道，不依赖重启改库。
- 任一音频权威表有数据时迁移拒绝无归档降级。生产旧签名不匹配，第 35 个迁移只增加账本；备份与生产的输出、输入、场景、路由语义 SHA-256 分别保持 `73d5dea914de9a04ab9b3dbb148a7e3384fb81e3663ee49fc2456d670e9aa1f0`、`9435473655c49f7b07b4eeaab94959eced1e217f943760040f88913e1d72056e`、`7179abb961a2efa549c93880f40b072e602c8cdba54b883a1dce444ed8c7a744`、`4a34c5245196174ca87943ee7509cbda6b5e64fca95d64af49f25efc07c0ae1a`。
- 发布前快照位于 `D:\smart-control-backups\20260917-025436\sqlite-5Jmr2a\database.sqlite`，配套恢复包和回执位于 `D:\smart-control-backups\migration-recovery\release-taRrPn`。

## 16. 2026-09-17 APP 发布目录启动写入退役

- `app_release_v1` 是客户端版本查询和管理员发布策略的唯一运行时来源；`AppReleaseService` 启动不再读取 `deploy/assets/app/manifest.json`，也不再写版本、下载地址、说明、强制更新、最低版本或启用状态。
- `EstablishAppReleaseCatalog1789640000000` 增加 `release_source`、`artifact_commit`、`artifact_sha256`、`artifact_size` 和 `artifact_built_at`。已有 Android 行只在下载地址精确等于内置地址时标记为 `bundled`；自定义行保持 `manual`，不存在时才建立当前随包版本。
- 随包 Android 的版本号、版本名、下载地址和产物字段只能由 `reconcile-app-release.cjs` 在校验 manifest schema、APK SHA-256/大小、提交与版本单调性后，以 `BEGIN IMMEDIATE` 单事务更新；发布说明、强制更新、最低支持版本和启用状态保持管理员控制。客户端只查询数据库，不直接读取 manifest。
- 管理后台对 bundled 元数据只读，防止 UI 制造数据库与 APK 不一致；manual 平台仍可编辑。下载文件名从数据库版本读取，manifest 只作为不可变部署制品的证明。
- 生产从 35 升至 36 个迁移；原版本 v1.1.14/code 22、下载地址、说明和策略均保留。最终产物提交 `564de946…14a0`，SHA-256 `79229763bcdf8a082e83b852e51fc16441cf93445307480ab3189c09fc196fa1`，大小 5,893,727 字节，与数据库和 APK 完全一致。发布前快照为 `D:\smart-control-backups\20260917-033608\sqlite-VXziBu\database.sqlite`；恢复包与原始/前滚回执为 `D:\smart-control-backups\migration-recovery\release-coIVpz`。
- 安卓产物工作流不再监听自身 manifest/APK，GK9000 部署忽略 Android 源提交并等待产物提交后显式调度。若迁移期间远端 main 仅因 manifest+APK 前进，受控恢复脚本验证祖先关系、严格差异和原迁移回执后前滚激活；任何其他差异继续保留 hold。

## 17. 2026-09-17 身份初始化与共享默认口令退役

- `users` 是新登录唯一凭据来源；PWA 和后台都校验个人用户名、密码、当前启用状态及数据库实时角色。后台仅允许 `admin` 角色，并签发 8 小时令牌；PWA 令牌保持 30 天。
- `client_auth_v1` 的签名密钥继续签发个人令牌，并在过渡期验证原有效期内的旧共享客户端令牌；`admin_auth_v1` 只验证已签发的旧后台令牌。两个共享密码均不再提供登录、修改或重置接口。
- `EstablishNamedIdentityAuthority1789650000000` 只为缺失的新库建立不可登录的占位行和随机签名密钥；已有非空行逐字段保留。服务启动只读，seed 不再建立 `admin/admin123`，代码中不再存在可登录的默认密码。
- 全新安装必须先运行迁移，再以环境变量向 `pnpm run admin:provision` 提供 12–128 位、同时含字母和数字的用户名密码。命令只在没有启用管理员时原子创建一次，不输出密码或哈希；之后统一在后台“用户管理”维护账户。
- 启动门禁要求第 37 个迁移、两张签名配置各恰有 id=1 且密钥有效，并至少有一个启用管理员；任何缺失都拒绝启动，不在运行时修复。
- PR #74 以合并提交 `65d67d0d7dde66ea87a1a07bda41087d88f07d9a` 发布成功。受控发布先建立 `D:\smart-control-backups\migration-recovery\release-ifx7MU`，再于 `restore-2wTp5V` 完成数据库与媒体隔离恢复演练，最后执行并激活第 37 个迁移；发布审计为 `PASS`，`RELEASE_HOLD` 不存在。
- 发布前恢复库与生产库逐字段比较确认：4 个 `users` 账号（1 个管理员、3 个操作员）、`admin_auth_v1`、`client_auth_v1` 的密码哈希、签名密钥、时间字段均未改变；两张认证表仍各恰有 id=1、密钥长度 64，最后管理员更新/删除保护触发器均存在。
- 生产数据库 `integrity_check=ok`、外键违规 0；仅新增 `EstablishNamedIdentityAuthority1789650000000` 迁移账本。密码单字段请求对 PWA 和后台登录均返回 400，证明共享口令入口不再签发新令牌；现有个人账号凭据未用于审计探测，也未被重置。
- 运行提交、`origin/main`、发布清单与 `/api/system/info` 均为 `65d67d0…7d9a`。后端、前端进程与端口归属正确且无重启循环；38 台设备在线，六路 HLS 均为 200、运行中、零重启，PWA 控制、灯光和大屏页面均为 200。

## 18. 2026-09-17 旧部署 seed 退役

- `EstablishOperationalCatalog1789660000000` 将旧 `SeedService` 中的场景/动作、逻辑设备、硬件、灯光分区/组和 UAT 新安装目录冻结为版本 1 不可变 JSON 快照；快照语义 SHA-256 为 `6b715cec7340877627bb1268becda68c182ba114c1f62d1d2d4a216180651bee`。
- 迁移只插入缺失唯一键，只对没有任何动作的已有场景建立推荐动作，只对精确旧 IP/型号或空驱动类型执行历史修复。已有场景、动作、执行历史、灯区、灯组、自定义记录和管理员删除意图都不会被重建或覆盖。
- 生产在线一致性副本从 37 个迁移升级到 38 个迁移时，除迁移账本外 40 张业务表的行数和逐行 SHA-256 全部不变；第二次执行为 0 项，前后完整性均为 `ok`、外键违规 0。
- 正式发布先保存 `D:\smart-control-backups\20260917-051004\sqlite-ThRC7w\database.sqlite`，再于 `D:\smart-control-backups\migration-recovery\restore-lbiONb` 完成数据库与媒体隔离恢复演练，恢复包和迁移回执位于 `D:\smart-control-backups\migration-recovery\release-87e6u8`。
- PR #76 以合并提交 `18b138be42b9750316161d0070c1f0a40fa3d64f` 发布成功。Git HEAD、`origin/main`、发布清单和运行 API 提交一致，工作区干净，`RELEASE_HOLD` 不存在；数据库 38 个迁移、完整性 `ok`、外键违规 0。38 台设备在线，六路 HLS 均运行中且零重启，PWA 控制、灯光和大屏入口均返回 200。

## 19. 2026-09-17 HVAC 与播放通道运行时建档退役

- `hvac_zone`、`hvac_indoor` 和 `playback_channels` 分别是空调功能区、内机展示/归属和物理播放通道的唯一权威目录。读取接口和服务启动不再补行，管理员删除、禁用、改名、排序和重新分组不会被重启复原。
- 场景引擎的 `hvac-zone` 动作改为查询 `hvac_zone` 与 `hvac_indoor.zone_code`，与 PWA 手动控制使用同一成员关系；已删除运行时代码中的第二份 14 区常量。
- `EstablishHvacPlaybackCatalog1789670000000` 仅在目标整表为空时建立新安装默认值：14 个区、22 台内机、3 个物理播放通道。任一表已有任何行时，该表保持逐字段不变；部分目录和禁用行同样视为明确的现场状态。
- 播放服务启动仍按现场要求清理三路瞬态播放会话，使重启后回到待机；该恢复只处理当前播放状态，不建立或修复物理通道目录。
- 生产在线一致性副本从 38 个迁移升级到 39 个迁移时，除迁移账本外 40 张业务表的行数和逐行 SHA-256 全部不变；第二次执行无待处理迁移。副本保持 13 个现场定制区、22 台内机、3 个播放通道，完整性 `ok`、外键违规 0。
- 内置媒体同时涉及 SQLite 记录与数据盘文件，继续作为下一独立批次处理；本迁移不读取、复制、删除或重建任何媒体文件和记录。
- 正式发布先保存 `D:\smart-control-backups\20260917-054502\sqlite-diWIgb\database.sqlite`，再于 `D:\smart-control-backups\migration-recovery\restore-uBi16p` 完成数据库与媒体隔离恢复演练，恢复包和迁移回执位于 `D:\smart-control-backups\migration-recovery\release-lo47Nf`。
- PR #78 以合并提交 `acfbd56a4e69aa8008c56e4c4c46cc4998ba9d05` 发布成功。生产 13 个区、22 台内机和 3 个播放通道的语义 SHA-256 分别保持 `9c13259066650e49c449d43069e61f5dd960206fe7e855d0b83a86a11fe8b756`、`9bbbcc9db499d902fa48d0904a8bc6843a94080504618e80ffced0330cbe2a31`、`d590d08a9d4b70383e64a6dd48ff0eb88ebd8783303cb6eebdb3d315ad9bc392`；15 条系统媒体指纹也保持 `e3c420c076ec64245c21edba3cf665b2c4d03e0a48e4db9fbf718791f1f7f6d7`。
- Git HEAD、`origin/main`、发布清单和运行 API 提交一致，工作区干净，`RELEASE_HOLD` 不存在；数据库 39 个迁移、完整性 `ok`、外键违规 0。38 台设备在线，后端/前端零重启，六路 HLS 均运行中且零重启，PWA 与园区大屏入口返回 200。

## 20. 2026-09-17 内置媒体启动建档退役

- `deploy/assets/bundled-media-manifest.json` 是 15 条随包系统媒体的版本化制品清单：13 个文件记录大小与 SHA-256，2 个网页记录固定本地 URL；`media_assets` 是运行时目录，`D:\Media` 是生产文件权威位置。
- `EstablishBundledMediaAuthority1789680000000` 增加稳定 `system_key` 和 `artifact_sha256`，建立系统键唯一索引，并把旧启动 M4V MIME 修复迁入第 40 个显式迁移。已有同名行只有在来源、归属和业务元数据与清单精确一致时才接管；冲突、重复或未登记系统媒体会阻断发布。
- `MediaService` 启动不再建档、复制、修复内置文件或改 MIME。部署 reconciler 只在持有连续写入隔离、数据库与媒体配套恢复证据时执行；日常发布末尾和迁移回执验证均使用只读 `--check-only`。新安装缺失文件写入 `MEDIA_ROOT/_system/<system_key>/`，已有文件摘要匹配时原路径和字节保持不动。
- 系统媒体在通用 API 中不可编辑、不可删除，事务内再次校验来源；前端标记“内置/受保护”并隐藏编辑删除入口。按原始名称查询限定 `source=system AND owner_user_id IS NULL`，用户上传同名文件不能遮蔽内置资产。
- 发布前生产审计确认 15 条系统记录、13 个文件均与清单元数据、大小和 SHA-256 一致。生产副本执行迁移和对账后，原有业务列逐字段保持；缺文件只读检查无写入，符号链接目录在越界写入前失败，失败清理只处理本次新建的文件和目录。
- PR #80 以合并提交 `28e6f6caedca3b110fdd3e095257c0c37a35e459` 发布成功。正式备份为 `D:\smart-control-backups\20260917-062105\sqlite-6OuZOa\database.sqlite`，恢复包、迁移回执和隔离恢复演练位于 `D:\smart-control-backups\migration-recovery\release-lyzijF`；回执记录清单版本 1、15 条资产和 `updated` 状态。
- 发布后独立只读验收确认：Git HEAD、`origin/main`、发布清单均为目标提交，跟踪工作区干净且无 `RELEASE_HOLD`；数据库 40 个迁移、完整性 `ok`、外键违规 0；15 个 `system_key` 唯一，13 个摘要完整，全部 13 个文件仍使用既有路径，未创建 `_system`；`BUNDLED_MEDIA_CURRENT 15`。后端和前端 HTTP 200，两个 PM2 进程均在线且重启数为 0。
- CI 和生产部署现在都在后端构建后运行 `backend/test/*.test.cjs` 运维测试，避免恢复、迁移、凭据存储和部署门禁脚本只存在于本地而未进入发布判定。

## 21. 2026-09-17 阶段 1 退出审计与异机迁移基线

- 非迁移生产代码禁止引用 `video-binding.json`、`park-ops-metrics.json`、`matrix-state.json` 和 `park-ops-control.json`，也禁止执行数据库结构 DDL；自动门禁会在 CI 和生产发布前检查。
- 15 个启动生命周期钩子已建立精确白名单，只允许设备/任务/缓存恢复、只读权威校验和媒体目录拓扑建立。新增启动钩子必须显式审查，不能静默恢复建档、seed 或默认值覆盖。
- 启动门禁会校验品牌 singleton、`video.binding` 当前文档 SHA-256、revision 和对应历史记录。品牌行缺失时保存返回 409；应用不再用默认值掩盖丢失。
- 数据迁移恢复包在生产验证成功后，通过受限动作按目标提交号复制到跳板机 `/var/backups/smart-control`。复制端重新校验 SQLite 完整性/外键、数据库与媒体 SHA-256、逐文件清单，追加写入且不覆盖或清理已有证据。
- P1-A21 的 `release-lyzijF` 已完成首份真实异机基线：87 个文件、4,220,164,447 字节；首次复制为 `VERIFIED`，重复执行为 `CURRENT`，提交关联和三类摘要字段一致，未留下临时传输目录。
- 这项异机复制覆盖“发生数据迁移的发布恢复包”。普通 6 小时 SQLite 快照和迁移后新增媒体的连续异机备份仍在阶段 3 实现，不能据此宣称已有连续媒体 RPO。
- PR #82 以合并提交 `a4bd519dc0460526daba399a9f3c21cd68c94476` 发布；发布前在线备份为 `D:\smart-control-backups\20260917-065958\sqlite-c1HbNJ\database.sqlite`。独立对账确认 17 张权威业务表与备份计数及 SHA-256 全部一致，数据库 40 个迁移、完整性 `ok`、外键违规 0，5 个前后端/PWA 入口均为 HTTP 200。
- GitHub Actions 当次因账户 Billing 在任务启动前拒绝执行；受限跳板机网关完成同一部署/验证/异机步骤。该平台故障不属于代码失败，但必须修复 Billing 才能恢复远端自动门禁。
