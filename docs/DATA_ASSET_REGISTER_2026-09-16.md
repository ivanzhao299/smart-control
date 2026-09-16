# Smart Control 数据资产与权威来源登记

> 建立日期：2026-09-16  
> 目标：每类数据只有一个权威写入源，并有明确的备份、恢复和迁移路径。

## 1. 生产路径基线

| 数据域 | 当前生产位置 | 当前权威源 | 备份与恢复 | 收敛动作 |
|---|---|---|---|---|
| 业务与配置数据库 | `D:\smart-control\database\smart-control.db` | SQLite | 发布前在线备份到 `D:\smart-control-backups\<timestamp>\sqlite-*\database.sqlite`，执行完整性校验 | 保持唯一数据库；所有结构变化只走 TypeORM 迁移 |
| 视频绑定、NVR、通道与 AI 区域 | `D:\smart-control-runtime\data\video-binding.json` | 运行时 JSON（阶段 1 过渡源） | 发布前连同 `.bak` 一起复制到快照的 `runtime-data` | 迁入 SQLite；摄像头拉流与后台编辑共同读取同一仓储 |
| 园区运营指标与文案 | `D:\smart-control-runtime\data\park-ops-metrics.json` | 运行时 JSON（阶段 1 过渡源） | 发布前复制到 `runtime-data` | 迁入统一配置表；保留一次性导入桥梁后停写 JSON |
| 园区大屏翻页控制状态 | `D:\smart-control-runtime\data\park-ops-control.json` | 运行时状态文件 | 发布前复制到 `runtime-data` | 归类为可重建短期状态；统一原子状态存储接口 |
| 音频矩阵状态 | 与数据库同目录的 `matrix-state.json` | 兼容状态文件 | 随数据库目录单独核验 | 对账 `audio_desired_link` 后，以 SQLite 为唯一期望状态 |
| 媒体元数据 | SQLite `media_assets` | SQLite | 随数据库在线备份 | 保持唯一来源；文件与记录通过事务式补偿保持一致 |
| 媒体文件与拍照上屏照片 | `D:\Media`；照片位于 `D:\Media\welcome-photos\<id>` | 数据盘文件，SQLite 保存索引 | 当前发布备份不复制全部媒体；删除走可恢复目录 | 增加独立媒体清单、校验和与异盘/远端增量备份 |
| 应用日志 | `D:\smart-control\logs` | 滚动日志 | 不参与业务数据恢复 | 统一版本、请求号和部署号字段；按保留周期归档 |
| 发布备份 | `D:\smart-control-backups` | 只读恢复证据 | SQLite 快照、`.env`、运行时 JSON、UAT 快照 | 增加离机副本，避免源数据与唯一备份同盘 |
| 服务密钥与外部凭据 | `backend\.env` 与 SQLite 中的认证记录 | 环境配置 / 数据库 | `.env` 随发布快照保护，接口响应必须脱敏 | 逐步迁入 CI/主机密钥存储；数据库只保存运行必需密文 |
| Android 签名私钥 | 当前仓库 `android-app/signing/internal.p12` | 仓库文件（不合规） | Git 历史存在副本 | 保持证书链迁移到 CI Secret 后从版本树移除并制定轮换 |

## 2. 数据分类规则

1. **权威业务数据**：SQLite 与媒体文件。必须备份、校验、可恢复，不允许由部署覆盖。
2. **过渡配置数据**：`video-binding.json`、`park-ops-metrics.json`。迁移期间只允许现有服务写入，迁入 SQLite 后停止写文件。
3. **可重建运行状态**：大屏当前页、进程状态、缓存与 PWA 缓存。故障时允许重建，但不得伪装成业务配置。
4. **审计与运行证据**：日志、迁移表、部署回执和备份清单。必须关联提交号和时间，不作为业务主数据回写。
5. **秘密材料**：密码、令牌签名密钥、OAuth 密钥和签名私钥。不得进入响应、日志或新提交。

## 3. 写入边界

- 数据库结构：只允许 `backend/src/migrations` 和发布迁移步骤写入。
- SQLite 业务数据：只允许对应 Nest 服务仓储写入，脚本验收统一使用只读连接和 `query_only`。
- 运行时 JSON：阶段 1 迁移完成前只允许统一存储接口写入，写入必须采用临时文件、刷盘、原子替换和修订号。
- 媒体文件：只允许媒体服务在数据盘目录内创建、移动和可恢复删除。
- 部署脚本：只复制和备份数据，不得删除、重置或用 Git 内容覆盖权威数据。

## 4. 阶段 1 对账要求

每个配置域迁移时必须记录迁移前后：记录数、文档版本、修订号、关键字段摘要和 SHA-256。迁移可重复执行，已导入的数据不得重复覆盖新版本；失败时保留原 JSON 和数据库事务前快照，通过前向修复继续，禁止代码回滚覆盖新数据。

