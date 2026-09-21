# 阶段 2：媒体上传队列拆分证据（P2-A21）

> 日期：2026-09-21  
> 功能提交：`5f3aa26`  
> 主分支合并：`90e9130`  
> 依据：[ENGINEERING_MATURITY_5_EXECUTION_PLAN.md](./ENGINEERING_MATURITY_5_EXECUTION_PLAN.md)

## 1. 本批目标

`MediaPage.vue` 在文件类型与目录遍历规则首次收敛后，仍直接承担文件校验、大文件确认、目录拖放、串行上传、批次进度、权限变化和页面卸载清理。上传请求跨越浏览器文件入口、权限状态和媒体服务，页面或登录身份在请求中途变化时，内联实现容易继续提交已经失效的进度、成功提示或刷新结果。

本批把完整上传队列旅程提取到 `useMediaUploadQueue.ts`。页面只提供当前权限、页面存活状态和上传端口，组合式用例统一管理上传状态与生命周期。

## 2. 收敛后的责任边界

组合式用例统一负责：

- 复用共享媒体类型策略校验文件，保持单文件 10 GB 上限；
- 对超过 500 MB 的文件保留原确认流程；
- 文件选择、普通拖放和目录递归拖放进入同一队列；
- 串行上传文件，统一维护当前文件、百分比、预计剩余时间和批次完成数；
- 权限或页面失效后清空待处理文件，并抑制过期的进度、结果提示和媒体列表刷新；
- Vue 作用域释放时清理队列和响应式状态。

`MediaPage.vue` 从 1616 行降至 1494 行。页面仍负责媒体浏览、筛选、预览、编辑和其他业务动作，后续阶段 2 将继续按用例边界拆分。

## 3. 防回归契约

上传队列可执行测试覆盖：

1. 非法类型和超过 10 GB 的文件被拒绝；
2. 两个文件严格串行上传，批次进度只提交已确认结果；
3. 超过 500 MB 的文件可以取消，权限不足时不进入上传；
4. Vue 作用域释放后清空等待队列并抑制活动请求返回的过期成功状态；
5. 页面提前失效时，即使组合式作用域尚未完成关闭，也不提交请求结果；
6. 目录拖放递归收集后复用同一上传队列；
7. 结构门禁禁止上传编排重新回流到 `MediaPage.vue`。

活动中的网络请求沿用 `mediaService.upload` 的既有中止边界；本批不声称在普通页面卸载时强制终止底层网络传输，而是在当前请求结束后停止后续队列，并保证过期结果不会写回界面。

## 4. 本地与远端验证

- 前端：184 项测试、类型检查、生产构建通过；生产构建 PWA 清单 128 项；生产依赖审计 0 项。
- 后端基线：97 套件 / 787 项测试、构建通过；运维测试 70 项中 67 项通过、3 项按环境跳过；生产依赖审计 0 项。
- 部署范围确认 `scope=frontend`、`highRisk=false`。
- [功能 PR #153](https://github.com/ivanzhao299/smart-control/pull/153)前端、后端和生产远程地址三项门禁全部通过。
- [PR CI 35607959476](https://github.com/ivanzhao299/smart-control/actions/runs/35607959476)与[主分支 CI 35608237134](https://github.com/ivanzhao299/smart-control/actions/runs/35608237134)均成功。
- 生产远程地址门禁继续要求原生 App 使用 `https://erp.cnjinhu.top:8443/control/`，防止浏览器 PWA 地址再次进入 App 配置。

## 5. 数据、兼容和生产发布

- 数据影响：无数据库迁移，不改写媒体记录、文件内容、设备配置或运行时 JSON。
- 兼容策略：API、路由、文件规则、10 GB / 500 MB 阈值、提示文案和上传顺序保持不变。
- [生产发布 35608236884](https://github.com/ivanzhao299/smart-control/actions/runs/35608236884)识别为纯前端、低风险发布，采用侧构建和零停机切换；明确跳过数据库备份、后端构建和服务重启。
- 生产 PWA v0.20.5 生成 128 项预缓存并保留上一版本 45 项兼容资源。
- 首次验证为 `MIGRATIONS_CURRENT`、`PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled`；WireGuard 独立复验为 `MIGRATIONS_CURRENT`、`PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`。
- 两次 `verify-deploy.js` 均通过；内置媒体为 `BUNDLED_MEDIA_CURRENT 15`，Android 制品为 `APP_RELEASE_CURRENT 1.1.16 (24)`。
- 权威发布清单记录提交 `90e9130d6ddde68d471a574e8fe24ee75b7e4e70`；本批无数据或迁移变化，异机恢复包被正确判定为不需要。
