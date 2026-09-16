# 最小量稳定部署规则（Minimal Deployment Rules）

> 2026-09-14 起生效。核心原则：**改哪里部署哪里，不做全量覆盖**，避免反复停服和引入无关风险。

## 背景

此前每次 push 到 main 都触发全量部署：停前端 → 构建后端 → 构建前端 → 跑迁移 → 重启双服务。即使只改了一个 CSS 颜色或一个音效文件，也要经历完整的停服-构建-重启流程，多次引发生产事故（09-13 三方并发部署停服、dist 锁/DB 锁等）。

## 部署范围自动检测

`scripts/deploy-from-ci.ps1` 在 `git merge --ff-only` 后自动运行 `git diff --name-only <旧提交> <新提交>`，按变更文件路径分类：

| 变更范围 | 匹配路径 | 部署动作 | 停机 |
|---|---|---|---|
| **静态资源** | `frontend/public/**`（含 park-ops 的 JS/CSS/图片/音效） | 直接复制到 `frontend/dist/` | 无 |
| **前端代码** | `frontend/src/**`、`index.html`、`vite.config`、`tsconfig` | 侧构建到 `dist-repair` 后交换到生产 dist | 无（vite preview 读盘，零停机） |
| **后端代码** | `backend/src/**` | 构建后端 → 仅重启 backend | 后端短暂重启（~5s） |
| **全量部署** | 以下任一命中则强制全量：<br>• `package.json` / `pnpm-lock.yaml`<br>• `.env*` / `ecosystem.config.js`<br>• `migrations/` 目录<br>• `deploy/` 目录<br>• `scripts/deploy*`、`backup*`、`update*`、`boot*`、`ensure*`、`run-migrations*`、`assert-release*`<br>• 前后端代码同时变更<br>• 其他未识别路径 | 构建后先只读检查迁移；无迁移时按普通全量流程，有迁移时进入停写、配套恢复包、隔离恢复演练、迁移回执和受控激活流程 | 仅在构建交换或受控迁移窗口停服 |

## 运行时数据保护（任何部署范围都生效）

KPI、视频绑定+AI 计数线/ROI、播控状态等现场写入的 JSON 一律存放在 git 仓库之外（Windows `D:\smart-control-runtime\data`，即 `DATA_DIR`）。部署 merge 前先抢救、清理未跟踪文件时按白名单永不删除、并随每次 verified 备份一并备份。详见 **`docs/RUNTIME_DATA_PROTECTION.md`**；任何部署都不得删除现场运行时数据与备份。

## 各范围详细说明

### 1. 静态资源部署（零停机）

- 适用：park-ops 大屏的 JS/CSS/HTML/图片/音效、前端 public 目录下任何文件
- 动作：将变更文件从 `frontend/public/` 复制到 `frontend/dist/` 对应位置
- 不构建、不安装依赖、不重启任何服务
- 验证：verify-deploy.js 的前端 "served" 新鲜度检查（比对 bundle 指纹）+ park-ops 产物检查
- 典型场景：改大屏样式、换翻页音效、调文案、换图片

### 2. 前端代码部署（零停机）

- 适用：`frontend/src/` 下的 Vue/React/TS 代码、入口 HTML、Vite 配置
- 动作：`pnpm install` → `vite build --outDir dist-repair` → 将产物复制到 `frontend/dist/`
- 不重启前端：vite preview 静态服务器每次请求都从磁盘读文件（见 `deploy/ecosystem.config.js` 注释），新构建产物立即生效
- 不碰后端、不跑迁移
- 验证：bundle 指纹比对（服务端吐出的 HTML 引用的 hash 与磁盘一致）
- 典型场景：改前端组件逻辑、加页面、调交互

### 3. 后端代码部署（仅后端重启）

- 适用：`backend/src/` 下的 NestJS 代码
- 动作：`pnpm install` → `pnpm run build` → `pm2 restart smart-control-backend`
- 不构建前端、不重启前端、不停前端
- 迁移：由后续"始终 reconcile 迁移"步骤统一处理（无待执行迁移时为 no-op）
- 验证：backend freshness='restart'（进程启动时间 > 最新产物 mtime）
- 典型场景：改 API 逻辑、加接口、调业务规则

### 4. 全量部署（高风险变更）

以下情况**必须**全量部署，不得走最小路径：
- 依赖变更（package.json / pnpm-lock.yaml）
- 环境变量或 pm2 配置变更（.env / ecosystem.config.js）
- 数据库迁移（migrations/）
- 部署脚本本身变更
- 前后端同时改代码
- 任何未被上述规则识别的文件变更

全量部署先构建后端并以 `--check-only` 只读检查迁移状态。没有待执行迁移时继续构建前端和重启双服务；存在待执行迁移时必须按以下状态机执行：

1. 读取生产真实计划任务清单并保存启用状态；`SmartControlFrontend` 仅在任务实际存在时纳入，不再假定现场有该任务。
2. 建立 `RELEASE_HOLD`，禁用计划任务，验证 PM2、端口、播放器和外部转换进程均已停写。
3. 同时生成数据库与媒体恢复包，在隔离目录完成恢复演练后才运行 TypeORM 迁移。
4. 迁移成功写入绑定源提交、候选提交、数据库路径和媒体根目录的回执；没有回执不得激活。
5. 激活脚本重新构建准确候选，验证回执与恢复包，启动服务并通过 `verify-deploy.js` 后恢复原计划任务状态。

普通预检失败或停写完成前失败，不得标记为“已尝试迁移”；部署应恢复旧提交和服务。迁移控制器开始后禁止只回退代码，必须保留代码、数据库、媒体与恢复证据的匹配集合。

## 安全机制

1. **按迁移边界恢复**：迁移控制器开始前可恢复旧提交、旧构建和服务；控制器开始后禁止代码单独回退；候选已经凭回执激活后保留匹配版本并继续运行
2. **备份不变**：每次部署前都运行 `scripts/backup.ps1` 生产备份
3. **部署锁不变**：`ProgramData\Anksen\smart-control-deploy.lock` 互斥锁防止并发部署
4. **健康检查不变**：部署后双端口健康检查（3200/5173）+ verify-deploy.js 权威验证
5. **迁移只读预检**：每次部署都运行 `run-migrations.js --check-only`；只有受控停写流程可以执行待处理迁移
6. **高风险兜底**：任何无法明确分类的变更自动归入全量部署，不会漏构建

## CI 工作流

`.github/workflows/deploy-gk9000.yml` 的 validate 阶段仍会构建双端（作为代码质量门禁），deploy 阶段调用 `gk9000-deploy <SHA>` → GK9000 上的 `deploy-from-ci.ps1` 自动判断范围并执行对应部署路径。

## 手动覆盖

如需强制全量部署（例如最小路径未覆盖某个特殊场景），可在 GK9000 上手动运行：
```powershell
scripts\deploy-from-ci.ps1 -Commit <SHA>
```
脚本会自动检测范围；如需绕过检测，临时修改变更文件使其命中 highRiskPattern 即可（不推荐）。

## 变更记录

- 2026-09-14：初始版本。由 09-13 生产事故复盘和运营大屏黑窗修复后提出，目标是减少部署停机时间和事故面。
- 2026-09-16：迁移发布改为显式状态机；统一生产任务清单与数据库/媒体路径解析，修复“只读预检失败也被当成迁移已执行并停止双服务”的门禁缺陷。
