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
- 新安装默认能力由部署 seed 保留：仅当对应场景的动作数为零时创建推荐动作，已有任意动作即跳过。后续如需升级场景模板，必须使用显式版本化迁移或管理员操作，不能恢复启动重写。
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
