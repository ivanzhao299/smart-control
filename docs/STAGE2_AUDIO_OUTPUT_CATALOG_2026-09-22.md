# 阶段 2：音频输出目录边界证据（P2-A31）

> 日期：2026-09-22
> 功能提交：`ff05c37`
> 主分支合并：`d4ae4a5`
> 依据：[ENGINEERING_MATURITY_5_EXECUTION_PLAN.md](./ENGINEERING_MATURITY_5_EXECUTION_PLAN.md)

## 1. 本批目标

`AudioPage.vue` 在已有音频视图模型、命令队列、矩阵控制器、播放进度、时长探测、场景和播放列表边界之外，仍直接维护输出目录加载、立体声配对投影、联动偏好和通道改名。左右声道改名使用两个顺序请求：第一路已经写入 SQLite、第二路失败时，页面却把两路名称都回滚为旧值，造成浏览器显示与服务端事实不一致。

本批新增 `useAudioOutputCatalog.ts`，把输出目录的读取、投影和改名写入收敛到一个组合式用例。SQLite 音频输出目录仍是唯一权威来源，页面只保留设备音量、静音和渲染编排。

## 2. 收敛后的责任边界

组合式用例统一负责：

- 输出目录读取及最新请求获胜，旧身份和旧请求不能覆盖当前目录；
- 立体声左右配对、卡片投影、显示名称、地址、左右行和联动偏好；
- 管理员改名入口、Enter/失焦去重和页面销毁清理；
- 立体声改名稳定捕获左右目标，并用 `Promise.allSettled` 独立核对结果；
- 两路全部失败时回滚乐观名称；部分成功时不制造虚假整体回滚，而是重新读取 SQLite 权威名称；
- 普通令牌变化取消旧操作、刷新目录名称，同时保留当前音量和静音显示；
- 真正切换服务器时清除旧服务器的通道状态和立体声偏好，再加载新服务器目录。

本批没有修改 EKX-808 指令、音量与静音命令、矩阵协议、音频配置 API、数据库实体或表结构。`AudioPage.vue` 从 1788 行降至 1673 行。

## 3. 防回归契约

新增 9 项行为测试，并更新 1 项结构契约，覆盖：

1. 目录并发读取只允许最新请求提交；
2. 立体声投影与联动偏好只在目录边界维护；
3. 管理员拒绝后不打开编辑器、不发送写请求；
4. Enter 后紧接失焦只提交一次；
5. 左右声道并行写入稳定目标并保留 `·左/·右` 后缀；
6. 部分保存成功后按服务端权威名称刷新；
7. 普通身份变化保留音量/静音、刷新名称并抑制旧成功提示；
8. 服务器变化清除旧运行状态和联动偏好；
9. 页面作用域销毁回滚未确认乐观名称并抑制迟到提示；
10. 结构门禁禁止目录读取、写入和立体声编排回流 `AudioPage.vue`。

测试使用注入服务和 Vue 内存状态，不连接生产数据库、音频矩阵或现场设备。

## 4. 验证与生产发布

- 前端 265 项测试全部通过，其中本批新增 9 项；类型检查、Vite 6.4.3 生产构建和 128 项 PWA 预缓存通过。
- 生产依赖审计为 0 个已知漏洞；发布范围 4 项和原生生产远程地址门禁通过。
- [PR #178](https://github.com/ivanzhao299/smart-control/pull/178)三项门禁全部通过；[PR CI 35698118160](https://github.com/ivanzhao299/smart-control/actions/runs/35698118160)与[主分支 CI 35698349512](https://github.com/ivanzhao299/smart-control/actions/runs/35698349512)均成功。
- 数据影响：无迁移；部署不读取或改写音频目录、音量、静音、场景、媒体或其他生产数据。管理员后续主动改名仍使用既有配置 API 和 SQLite 权威表。
- [生产发布 35698349621](https://github.com/ivanzhao299/smart-control/actions/runs/35698349621)识别为 `frontend`、`highRisk=false`，采用侧构建和零停机切换；明确跳过数据库备份、后端构建与后端重启，也未执行迁移。
- 发布内和 WireGuard 独立复验均通过 `verify-deploy.js`；结果为 `MIGRATIONS_CURRENT`、`PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`、`BUNDLED_MEDIA_CURRENT 15`、`APP_RELEASE_CURRENT 1.1.17 (25)`。
- 首轮验证发现播放器需要由现有 watchdog 恢复，结果为 `PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled`；独立复验随后确认其保持存活。
- 权威发布清单记录 `d4ae4a51429e7aae217a7a82592b70ac867e0708`；本批无迁移恢复包，门禁明确输出 `OFFSITE_BUNDLE_NOT_REQUIRED`。
