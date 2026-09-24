# 阶段 2：媒体文件策略收敛证据（P2-A35）

> 日期：2026-09-22
> 功能提交：`6454480`
> 主分支合并：`d5fd83c`
> 依据：[ENGINEERING_MATURITY_5_EXECUTION_PLAN.md](./ENGINEERING_MATURITY_5_EXECUTION_PLAN.md)

## 1. 本批目标

`media.service.ts` 原先分别维护上传文件、磁盘扫描和孤儿文件导入的类型识别、扩展名回退、MIME 归一化和安全文件名规则。同一文件可能因进入路径不同而得到不同媒体类型或 MIME；文件策略又与数据库、配额、转码和恢复职责混在一个 1131 行服务中，增加后续修改风险。

本批新增 `media-file-policy.ts`，把纯文件策略收敛为单一模块，`media.service.ts` 从 1131 行降至 1050 行。上传、服务器磁盘扫描和孤儿文件导入现在使用同一规则。

## 2. 收敛后的责任边界

文件策略模块统一负责：

- 按 MIME 前缀识别视频、音频、图片和文档；
- MIME 缺失或不可靠时按扩展名安全回退；
- 将磁盘文件扩展名映射为统一媒体类型和 MIME；
- 归一化上传 MIME，并保留 M4V 映射为 `video/mp4` 的既有兼容行为；
- 清理上传文件名中的路径和非法字符，同时保留中文名称；
- 对少见但已允许的音频类型维持音频回退，不改变既有媒体接纳范围。

本批没有修改接口路径、数据库实体、表结构、媒体数据目录、配额、转码参数、删除策略或恢复流程，也没有移动或改写生产媒体文件。

同时修复仓库卫生问题：旧 `.gitignore` 中的 `media/` 会匹配任意层级同名目录，导致 `backend/src/modules/media/` 下的新源码被静默忽略。规则已收窄为仓库根目录 `/media/`；发布范围门禁把 `.gitignore` 识别为发布控制文件，与后端源码组合时仍准确分类为后端低风险发布。

## 3. 防回归契约

新增 6 项文件策略测试，覆盖：

1. 常见媒体和文档 MIME 分类；
2. MIME 缺失时的扩展名回退；
3. 磁盘文件类型与 MIME 映射；
4. M4V 与少见音频格式的兼容归一化；
5. 中文文件名保留和路径、非法字符清理；
6. 未知格式安全回退。

发布范围测试增加 `.gitignore` 契约，持续阻止宽泛 `media/` 规则回流，并验证 `.gitignore` 与后端变更组合为 `backend`、`releaseControl=true`、`highRisk=false`。

测试只使用内存值和临时输入，不连接生产数据库，不扫描、移动或改写生产媒体文件。

## 4. 验证与生产发布

- 媒体相关 4 套件 78 项测试通过；后端全量 99 套件 798 项测试、后端构建和新文件静态检查通过。
- 运维门禁共 70 项，其中 67 项通过、3 项因本地环境条件不具备而按设计跳过；发布范围 5 项通过，生产依赖审计为 0 个已知漏洞。
- [PR #187](https://github.com/ivanzhao299/smart-control/pull/187)三项门禁全部通过；[PR CI 35711428314](https://github.com/ivanzhao299/smart-control/actions/runs/35711428314)与[主分支 CI 35711674152](https://github.com/ivanzhao299/smart-control/actions/runs/35711674152)均成功。
- [生产发布 35711674196](https://github.com/ivanzhao299/smart-control/actions/runs/35711674196)识别为 `backend`、`releaseControl=true`、`highRisk=false`，执行后端最小发布：构建并重启后端，明确跳过前端构建，前端进程未重启。
- 发布前生成生产数据库在线备份 `D:\smart-control-backups\20260922-174247\sqlite-mPerTi\database.sqlite`（40,912 KB），并备份 `.env`、3 份权威运行配置和 3 份旧目录兼容配置。
- 数据库只读检查两次均为 `MIGRATIONS_CURRENT`，没有执行迁移；发布内和 WireGuard 独立复验均通过 `verify-deploy.js`。
- 首轮验证由现有 watchdog 恢复播放器，结果为 `PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled`；独立复验随后确认 `PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`。
- 两轮制品对账均为 `BUNDLED_MEDIA_CURRENT 15`、`APP_RELEASE_CURRENT 1.1.17 (25)`；权威发布清单记录 `d5fd83c18d7975b0e218f2fc81d4e83ce8b64828`。
- 本批没有数据库迁移，因此异机门禁明确输出 `OFFSITE_BUNDLE_NOT_REQUIRED`。
