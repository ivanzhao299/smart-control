# 运行时数据保护规约（Runtime Data Protection）

> 2026-09-15 立。起因：生产端在 PWA 改顶部 KPI 点保存后被重置、AI 视频分析的计数线/ROI 框编辑后变回默认一条竖线。
> 根因不是"没保存"，而是**运行时数据写在了 git 仓库工作区内，被部署流程当未跟踪文件删除 / 被 git merge 覆盖**。
> 本文件是这类数据的存放、部署保护、备份与恢复的唯一权威说明，**绝不许删除现场运行时数据与备份**。

## 1. 什么是"运行时数据"

现场运行过程中由用户/系统写入、每次部署都必须原样保留的数据：

| 文件 | 内容 | 后端读写点 |
| --- | --- | --- |
| `video-binding.json` | NVR/通道绑定、AI 开关、**计数线 countLine、检测区域 roiPolygon**、分屏布局 | `cameras/video-binding.service.ts` |
| `park-ops-metrics.json` | 运营大屏顶部 KPI / 业务数字文档（PWA"运营数据"保存） | `cameras/park-ops-metrics.controller.ts` |
| `park-ops-control.json` | 大屏播控状态（输入源、轮播等） | `cameras/park-ops-control.controller.ts` |
| `database/smart-control.db` | 主数据库（含"拍照上屏"照片，存 `system-branding` 表） | TypeORM |

> 纯展示/设备配置走 JSON 文件，**不做数据库迁移**；需要事务/多用户关系的数据才入库。

## 2. 存放位置：必须在 git 仓库之外

后端三处读写统一按以下优先级解析目录（`process.env.DATA_DIR || <cwd>/data`）：

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
- 手动恢复：把目标快照里的 `runtime-data\*.json` 复制回 `D:\smart-control-runtime\data`，再 `pm2 restart smart-control-backend --update-env`。
- 数据库恢复走 `backend/scripts/verified-sqlite-backup.cjs` 的配套流程，先备份当前库再覆盖。

## 5. 以后新增"现场可写文件"的规约（必须同时做）

1. 后端读写一律走 `process.env.DATA_DIR || join(process.cwd(),'data')`，不要写死仓库内相对路径；
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
