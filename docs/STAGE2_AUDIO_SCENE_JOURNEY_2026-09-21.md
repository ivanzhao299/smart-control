# 阶段 2：音频场景长按用例边界收敛

> 日期：2026-09-21
>
> 范围：P2-A17
>
> 结论：场景列表、当前场景回读、长按确认、失败回滚和页面生命周期清理已从 `AudioPage` 提取为组合式用例；首次以真实生产发布证明 P2-A16 的前端分层发布范围有效。

## 1. 问题与修正

旧 `AudioPage` 同时维护场景查询、设备应用、乐观高亮、失败回滚、长按计时、触点移动取消和动画帧清理。页面离开时只取消计时状态，动画帧和可见进度缺少独立生命周期边界；这些细节也只能通过页面源码间接验证。

本批新增两个边界：

1. `frontend/src/features/hold-to-confirm-controller.ts`：纯控制器负责单一活动手势、进度、移动阈值、提前松手提示、替换手势、取消和销毁。
2. `frontend/src/composables/useAudioScenes.ts`：负责场景列表、当前场景、忙碌状态、长按可见状态、应用场景和权威回读。

`AudioPage` 只绑定组合式用例返回的状态与动作；离开 keep-alive 页面时取消手势，卸载时销毁控制器并清除动画帧。原有 1100 毫秒确认时长、12 像素移动阈值、乐观高亮、失败回滚和提示文案保持。

## 2. 行为不变量

- 场景列表仍由 `audioConfigService.listScenes` 提供。
- 场景应用仍调用 `audioService.applyScene`，成功后以 `audioService.currentScene` 回读为准。
- 同一时间只有一个活动手势；新手势替换旧手势并清空旧进度。
- 移动超过阈值立即取消；未达到确认时间松手只发出一次提示信号。
- 应用失败恢复此前高亮并显示原有错误信息。
- 页面停用和卸载都清空可见进度，不保留后台动画帧。

## 3. 数据与发布边界

- 无数据库迁移，不读写生产配置或媒体，不主动发送现场场景命令。
- 自动测试使用注入时钟和调度器，不连接设备。
- API、场景数据结构、确认时长、移动阈值、模板和样式不变。
- 生产权威差异分类为 `frontendCode=true`、`backendCode=false`、`releaseControl=false`、`highRisk=false`、`scope=frontend`。

## 4. 自动验证

新增 6 项回归，覆盖：达到时长确认、移动取消、提前松手提示、替换手势、销毁清理，以及页面必须把完整场景旅程委托给组合式用例。

- 前端 160 项测试、TypeScript 类型检查、生产构建和依赖审计通过。
- 生产构建生成 128 条唯一 PWA 预缓存记录。
- 发布范围专项确认本批为纯前端低风险变更。
- [PR #145](https://github.com/ivanzhao299/smart-control/pull/145) 的前端、后端和生产远程地址门禁全部通过。
- 合并后的[主分支 CI](https://github.com/ivanzhao299/smart-control/actions/runs/35592365551)再次全部通过。

## 5. 生产发布与 P2-A16 真实验证

功能提交为 `e73de338f227550e18b5fd3c7865da6d0583d9ce`，合并提交为 `73674594b7e56f7b7ebe08403bcb21104ad93c64`。[生产发布 35592365531](https://github.com/ivanzhao299/smart-control/actions/runs/35592365531)成功：

- 云端前端和后端生产门禁并行通过，远程地址门禁通过。
- GK9000 权威分类记录 `frontendOnly=True`、`fullDeploy=False`、`releaseControl=False`、`highRisk=False`。
- 日志明确记录“不需要数据库备份”和“仅前端最小发布”；没有建立 SQLite 备份，没有构建或重启后端。
- 迁移只读检查为 `MIGRATIONS_CURRENT`。
- 发布内 `verify-deploy.js` 与独立 WireGuard 二次验证均通过。
- LED 播放器记录 `PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`。
- 15 项内置媒体和 Android 1.1.16（24）制品对账保持当前状态。
- 发布清单和 `/control/deployment-version.json` 均指向合并提交 `73674594…`，构建 ID 为 `8d9b70a5-fa3f-47c3-893d-21aed1307f5e`，工作树 `clean=true`。
- 首页、音频页、后台登录、健康接口和部署版本接口均返回 HTTP 200；API、数据库、WebSocket 和调度器均为 `up`。
- 线上 Service Worker 为 128 条记录、128 个唯一 URL；全部 128 个资源逐一返回 HTTP 200。

这次是 P2-A16 合并后的第一批真实纯前端功能发布，证明“完整验证、按生产真实差异最小执行、无条件发布后复验”可以同时成立。

## 6. 后续边界

`AudioPage` 仍包含播放列表编排、静音渐变、配置编辑和大量模板。下一批继续按行为边界提取一个完整用例，或转向 `MainLayout`、`PlayerConsole` 与 `media.service` 的高复杂度职责；不在同一批混合设备命令语义和结构重写。
