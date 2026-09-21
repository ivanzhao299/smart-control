# 阶段 2 生产发布范围与真实基线收敛证据（2026-09-21）

> 范围：P2-A16  
> 功能提交：`6eaf5330909ec497e6ee4e0e3ebe47b4c298b2a8`  
> 合并提交：`65c31e36a3f88955030be3317080b939f872e003`  
> PR：[GitHub #143](https://github.com/ivanzhao299/smart-control/pull/143)

## 问题与根因

GitHub 发布工作流原先按“本次推送前后提交”预判发布范围，GK9000 则按“生产上次真实发布提交到目标提交”执行。后者是正确的权威区间，但共享分类器把 `.github/**`、`tools/ci/**` 和原生 App 代码当成未知运行时文件。

P2-A15 因此复现出确定性偏差：GitHub 将功能差异判为纯前端，生产机从 `295cb30b…` 比较到 `be9ba863…` 时还看到了期间未触发生产发布的工作流和 CI 门禁文件，错误升级为 `highRisk=true` 的全量发布，建立数据库备份并重启双服务。

另一个安全缺口是：若上一批后端发布失败，下一批只有前端改动，GitHub 的较窄区间只验证前端，而生产机的真实区间会包含前后端并执行全量发布。主分支目标代码可能因此缺少同一次发布流程内的后端门禁。发布后的 WireGuard 二次验证同样按较窄预判条件执行，静态或前端预判会跳过它。

## 收敛方式

1. 运行时范围与发布控制风险分层：
   - `.github/**`、`tools/ci/**` 标记为 `releaseControl=true`，不参与 GK9000 服务构建范围。
   - `android-app/**`、`ios-app/**` 使用独立分发链，不参与 GK9000 运行时范围。
   - 测试与文档继续作为非运行时文件处理。
   - `deploy/**`、生产 `scripts/**`、依赖、环境、迁移、前后端混合变更及所有未知路径仍失败关闭到 `full`。
2. 增加 `none` 范围。目标区间只有发布控制、原生 App、测试或文档时，生产机同步提交并执行公共一致性门禁，不构建服务、不建立数据库备份、不重启。
3. GK9000 继续以“上次真实发布提交 → 当前目标提交”为部署范围唯一权威，不接受 GitHub 较窄区间覆盖。
4. 每次生产发布在云端并行执行完整前端与后端门禁。这样不依赖远端读取生产基线，也能覆盖此前失败发布累计的另一端代码；并行验证不会扩大生产执行范围。
5. 发布后的 `gk9000-verify` 改为始终执行，不再因 GitHub 预判为静态或前端而跳过。

## 回归与本地验证

- 发布范围专项 4/4 通过；新增覆盖发布控制文件、CI 工具、原生 App 与前端代码累计的真实组合。
- 旧问题区间 `295cb30b…be9ba863` 在新分类器下为：
  - `scope=frontend`
  - `releaseControl=true`
  - `highRisk=false`
- 纯发布控制与原生 App 组合为 `scope=none`。
- 前后端混合、依赖、部署脚本和未知路径仍为 `scope=full`。
- 前端 154 项、类型检查、生产构建和生产依赖审计通过。
- 后端 97 套件 787 项、构建、运维脚本 70 项（67 通过、3 个环境跳过）和生产依赖审计通过。
- 工作流 YAML 解析、部署门禁专项 19 项和差异格式检查通过。
- [PR CI 35590345643](https://github.com/ivanzhao299/smart-control/actions/runs/35590345643)与[主分支 CI 35590561303](https://github.com/ivanzhao299/smart-control/actions/runs/35590561303)全部通过。

## 生产发布与核验

本批修改了 `scripts/deploy-from-ci.ps1`，按既有安全规则有意执行一次全量发布。[生产发布 35590561309](https://github.com/ivanzhao299/smart-control/actions/runs/35590561309)成功：

- GitHub 前后端生产门禁并行完成；完整工作流约 4 分 48 秒，其中生产部署与两次验证为 2 分 22 秒。
- 生产权威分类记录 `fullDeploy=True`、`releaseControl=True`、`highRisk=True`，高风险来源是部署脚本本身，符合预期。
- 发布前建立 SQLite 备份：`D:\smart-control-backups\20260921-184934\sqlite-VmnsTA\database.sqlite`（40,912 KB）。
- 两次迁移只读检查均为 `MIGRATIONS_CURRENT`。
- 发布内验证和独立 WireGuard 二次验证均通过 `verify-deploy.js`。
- LED 播放器恢复门禁通过；二次验证记录 `PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`。
- 15 项内置媒体与 Android 1.1.16（24）制品对账为当前版本。
- 生产发布清单与 `deployment-version.json` 均为 `65c31e36a3f88955030be3317080b939f872e003`，构建 ID `3c6ec294-e582-44bb-bf94-aa949d532123`，工作树标记 `clean=true`。
- 公网首页、音频页、后台登录、欢迎页、运营大屏和健康接口均为 HTTP 200；健康报告 API、数据库、WebSocket、调度器均为 `up`。
- 线上 Service Worker 为 128 条记录、128 个唯一 URL、零重复；128 个当前资源逐一复核均可返回 200（一次 TLS 握手超时的资源单独重试即 200）。

## 结果

生产服务构建范围现在只由真实运行时差异决定，发布控制文件不再污染下一次小改范围；云端验证覆盖完整目标提交，生产后二次验证不再有条件缺口。生产数据库、迁移、媒体、播放器和应用制品均保持当前状态，本批没有业务数据迁移或设备命令。
