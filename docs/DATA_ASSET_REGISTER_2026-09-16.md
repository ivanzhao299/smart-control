# Smart Control 数据资产与权威来源登记

> 建立日期：2026-09-16  
> 目标：每类数据只有一个权威写入源，并有明确的备份、恢复和迁移路径。

## 1. 生产路径基线

| 数据域 | 当前生产位置 | 当前权威源 | 备份与恢复 | 收敛动作 |
|---|---|---|---|---|
| 业务与配置数据库 | `D:\smart-control\database\smart-control.db` | SQLite | 发布前在线备份到 `D:\smart-control-backups\<timestamp>\sqlite-*\database.sqlite`，执行完整性校验 | 保持唯一数据库；所有结构变化只走 TypeORM 迁移 |
| 视频绑定、NVR、通道与 AI 区域 | SQLite `runtime_config_documents` 的 `video.binding` 文档 | 版本化数据库配置；`video-binding.json(.bak)` 仅保留为已执行迁移和恢复证据，应用启动不读取 | SQLite 配套备份包含当前值与修订历史；旧 JSON 继续随 `runtime-data` 归档 | 后台编辑、AI 下发和摄像头读取均通过 `VideoBindingService`；新库默认文档只由迁移建立；禁止恢复文件写入 |
| 园区运营指标与文案 | SQLite `runtime_config_documents` 的 `park.ops.metrics` 文档 | 版本化数据库配置；`park-ops-metrics.json(.bak)` 仅保留为已执行迁移和恢复证据，应用启动不读取 | SQLite 配套备份包含当前值与修订历史；旧 JSON 继续随 `runtime-data` 归档 | 后台编辑和运营大屏读取均通过 `ParkOpsMetricsService`；未发布时保持空值；禁止恢复文件写入 |
| 园区大屏视觉布局 | SQLite `runtime_config_documents` 的 `park.ops.visual` 文档 | 版本化数据库配置；`system_branding_v2.parkOpsConfigJson` 仅保留为首迁前快照 | SQLite 配套备份包含当前值与修订历史；旧字段随数据库归档 | 读取和保存均通过 `RuntimeConfigStore`；编辑器携带 revision，旧写入冲突返回 409；禁止恢复旧字段写入 |
| 系统品牌与场景动作 | SQLite `system_branding_v2`、`scenes`、`scene_actions` | 关系表；品牌默认行由迁移建立，场景动作参数受 JSON 解析校验 | 随 SQLite 在线备份和迁移恢复包保存 | 禁止启动时从仓库文件覆盖 Logo、品牌或场景动作；历史场景哨兵只作证据；部署 seed 仅为空场景建立新安装默认值 |
| 电源回路与时序器通道 | SQLite `power_circuit` | 关系表；服务启动只读；新库默认值与精确历史修复由版本化迁移建立 | 随 SQLite 在线备份和迁移恢复包保存；含权威回路时禁止无归档降级 | 禁止启动时补建固定编码或覆盖网关/通道；后台增删改是日常配置入口 |
| 驱动模板目录 | SQLite `driver_templates` | 关系表；内置目录由版本化迁移建立，现场非内置模板由管理接口建立；服务启动只读 | 随 SQLite 在线备份和迁移恢复包保存；含内置目录时禁止无归档降级 | 禁止从 adapter 常量启动覆盖；新增或升级内置驱动必须有显式迁移，已有同名及启用状态保留 |
| 硬件与驱动厂商品牌目录 | SQLite `brands` | 关系表；产品品牌与已有引用由版本化迁移建立，新增硬件/自定义驱动在引用写入时即时建档；服务启动只读 | 随 SQLite 在线备份和迁移恢复包保存；含品牌目录时禁止无归档降级 | 禁止启动扫描派生写入；只补缺失名称，不覆盖 Logo、联系方式、备注、自定义品牌或禁用状态 |
| 园区大屏翻页控制状态 | 后端 `ParkOpsControlService` 进程内存 | 可重建短期控制信号；不是业务数据 | 不备份；进程重启恢复第 1 页、关闭自动播放且无待刷新指令 | 禁止创建 JSON 或数据库副本；仅公开状态轮询，变更必须鉴权 |
| 音频矩阵期望状态 | SQLite `audio_desired_link` | SQLite；旧 `matrix-state.json` 写入已退役，生产文件不存在 | 随数据库在线备份；兼容 GET 只从 SQLite 映射 | 当前前端与对账器均使用 SQLite；旧 POST 固定返回 410，禁止重新形成文件源 |
| 媒体元数据 | SQLite `media_assets` | SQLite | 随数据库在线备份 | 保持唯一来源；文件与记录通过事务式补偿保持一致 |
| 媒体文件与拍照上屏照片 | `D:\Media`；照片位于 `D:\Media\welcome-photos\<id>` | 数据盘文件，SQLite 保存索引 | 当前发布备份不复制全部媒体；删除走可恢复目录 | 增加独立媒体清单、校验和与异盘/远端增量备份 |
| 应用日志 | `D:\smart-control\logs` | 滚动日志 | 不参与业务数据恢复 | 统一版本、请求号和部署号字段；按保留周期归档 |
| 发布身份清单 | `D:\smart-control-runtime\data\release.json` | 已验证发布的提交、分支与时间证据；Git/环境变量仍是运行代码身份首选来源 | 随 `runtime-data` 进入发布备份；丢失时由下一次验证通过的发布重建 | 不作为业务数据源；只在权威部署验证后原子更新 |
| 发布备份 | `D:\smart-control-backups` | 只读恢复证据 | SQLite 快照、`.env`、运行时 JSON、UAT 快照 | 增加离机副本，避免源数据与唯一备份同盘 |
| 服务密钥与外部凭据 | `backend\.env` 与 SQLite 中的认证记录 | 环境配置 / 数据库 | `.env` 随发布快照保护，接口响应必须脱敏 | 逐步迁入 CI/主机密钥存储；数据库只保存运行必需密文 |
| Android 签名私钥 | GitHub Actions `ANDROID_SIGNING_*` secrets | 加密 CI 密钥；仓库仅记录公开指纹 | Git 历史仍存在旧副本，当前版本已移除 | 保持现有证书以兼容覆盖升级；疑似泄露时冻结发布并按设备清单维护重装 |

## 2. 数据分类规则

1. **权威业务数据**：SQLite 与媒体文件。必须备份、校验、可恢复，不允许由部署覆盖。
2. **冻结迁移来源**：`video-binding.json(.bak)`、`park-ops-metrics.json(.bak)` 与 `system_branding_v2.parkOpsConfigJson` 均已停止写入，仅保留为首迁导入和恢复对账证据，不再是运行时权威源。
3. **可重建运行状态**：大屏当前页、进程状态、缓存与 PWA 缓存。故障时允许重建，但不得伪装成业务配置。
4. **审计与运行证据**：日志、迁移表、部署回执和备份清单。必须关联提交号和时间，不作为业务主数据回写。
5. **秘密材料**：密码、令牌签名密钥、OAuth 密钥和签名私钥。不得进入响应、日志或新提交。

## 3. 写入边界

- 数据库结构：只允许 `backend/src/migrations` 和发布迁移步骤写入。
- SQLite 业务数据：只允许对应 Nest 服务仓储写入，脚本验收统一使用只读连接和 `query_only`。
- 冻结的运行时 JSON：只允许首迁和恢复对账读取；已迁移的旧 JSON 禁止写回。瞬时控制信号不得为“持久化”另建 JSON 副本。
- 媒体文件：只允许媒体服务在数据盘目录内创建、移动和可恢复删除。
- 部署脚本：只复制和备份数据，不得删除、重置或用 Git 内容覆盖权威数据。

## 4. 阶段 1 对账要求

每个配置域迁移时必须记录迁移前后：记录数、文档版本、修订号、关键字段摘要和 SHA-256。迁移可重复执行，已导入的数据不得重复覆盖新版本；失败时保留原 JSON 和数据库事务前快照，通过前向修复继续，禁止代码回滚覆盖新数据。
