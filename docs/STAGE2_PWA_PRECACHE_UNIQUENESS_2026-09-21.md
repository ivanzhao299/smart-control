# 阶段 2 PWA 预缓存唯一性收敛证据（2026-09-21）

> 范围：P2-A15  
> 功能提交：`a5d0f2cad094001b59f7fcfcbb03e4195cd2c718`  
> 合并提交：`be9ba863efd3f27aae6e0575f1727282100e80c8`  
> PR：[GitHub #141](https://github.com/ivanzhao299/smart-control/pull/141)

## 问题与根因

P2-A14 发布后的 `sw.js` 含 131 条 Workbox 记录，但只有 128 个唯一 URL。三个 PWA 图标同时由 `includeAssets` 与覆盖 `svg/png` 的 `globPatterns` 提供，因此每个图标进入清单两次：

- `icons/pwa-192x192.png`
- `icons/pwa-512x512.png`
- `icons/app.svg`

重复项不会改写数据库，但会让离线清单、发布核验和容量统计产生歧义，也掩盖配置继续分叉的风险。

## 收敛方式

- 删除 `includeAssets` 的第二份图标声明，保留 `globPatterns` 作为静态图标的单一预缓存来源。
- 保留 Web App Manifest 的图标声明；它负责安装元数据，不作为第二份 Workbox 输入。
- 在 Workbox `manifestTransforms` 增加构建期唯一性门禁；出现重复 URL 时构建立刻失败并打印冲突 URL。
- 增加配置和生成制品回归测试，检查单一来源、门禁存在以及已有构建的 `sw.js` URL 唯一性。
- 保留 PR #139 已加入的 `/welcome` 与 `/park-ops` 导航回退黑名单，欢迎页独立静态入口不受本批影响。

## 本地与 CI 验证

- 前端 154 项测试全部通过，其中新增 2 项预缓存配置/制品回归。
- `vue-tsc --noEmit` 与生产构建通过；本地 Workbox 输出 128 条记录、128 个唯一 URL，三个目标图标各一次。
- 前端生产依赖审计无已知漏洞。
- 发布范围测试 3/3 通过，功能差异判定为 `frontendCode=true`、`backendCode=false`、`highRisk=false`。
- PR CI、主分支前端/后端 CI 和生产远程地址门禁全部通过。Linux CI 制品因平台分块差异生成 129 个唯一 URL，仍为零重复；生产 Windows 制品为 128 个唯一 URL。

## 生产发布与独立核验

[生产发布 35579092980](https://github.com/ivanzhao299/smart-control/actions/runs/35579092980) 成功，发布清单和 `deployment-version.json` 均为 `be9ba863efd3f27aae6e0575f1727282100e80c8`，构建 ID 为 `9f7ebc20-d20b-44b9-bc0d-d7d9c01644f4`。

- `/control/`、`/control/audio`、`/control/admin/login` 均返回 200。
- 健康接口返回 200，API、数据库、WebSocket 和调度器均为 `up`。
- 线上 `sw.js` 为 128 条记录、128 个唯一 URL，三个图标各出现一次；128 个 URL 逐一请求均为 200。
- `MIGRATIONS_CURRENT`、播放器 slot 1 恢复和 watchdog、15 项内置媒体、Android 1.1.16 制品对账及 `verify-deploy.js` 均通过。

## 发布范围偏差与后续边界

GitHub 门禁仅比较本次合并父提交，正确预判为前端发布；生产机则从上次实际发布提交 `295cb30b…` 比较到目标提交，把期间已合并但未触发运行时发布的工作流门禁一并计入，判为 `highRisk=true`。因此本批在生产侧升级为全量发布，建立了 `D:\smart-control-backups\20260921-164205\sqlite-ZaG5To\database.sqlite` 后重启双服务。

数据备份、迁移只读检查和发布后健康验证均通过，但这次不必要的升级说明“GitHub 推送区间”不能代替“生产真实发布区间”。P2-A16 已完成收敛：运行时范围与发布控制文件分层，目标机继续使用真实发布基线；云端每次并行验证完整前后端，避免此前发布失败造成验证缺口；WireGuard 发布后二次验证改为无条件执行。详见 [P2-A16 证据](./STAGE2_DEPLOYMENT_SCOPE_BASELINE_2026-09-21.md)。
