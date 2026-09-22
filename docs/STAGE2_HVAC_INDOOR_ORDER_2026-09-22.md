# 阶段 2：空调内机排序并发边界证据（P2-A26）

> 日期：2026-09-22  
> 功能提交：`5ce7053`  
> 主分支合并：`17ba859`  
> 依据：[ENGINEERING_MATURITY_5_EXECUTION_PLAN.md](./ENGINEERING_MATURITY_5_EXECUTION_PLAN.md)

## 1. 本批目标

`HvacPage.vue` 原来直接维护内机拖放状态、乐观排序、持久化和失败回滚。连续拖放时，较早请求的迟到失败会把已经成功保存的新顺序回滚掉；页面销毁后的迟到失败也会继续修改界面并弹出错误。

本批把内机排序完整提取到 `useHvacIndoorOrder.ts`。每次保存绑定递增修订号、当前身份和组合式用例作用域，只有当前仍有效的请求才能回滚和提示；较旧请求失败或页面销毁后的响应不再污染新顺序。

## 2. 收敛后的责任边界

组合式用例统一负责：

- 拖放起点、经过目标和结束状态；
- 以稳定内机 `idx` 计算顺序，不依赖可能变化的数组下标；
- 乐观更新并向既有 `reorderIndoors` 接口提交完整内机 ID 顺序；
- 当前保存失败时恢复本次操作前的顺序并给出明确错误；
- 用请求修订号和身份边界阻止旧失败覆盖更新结果；
- 页面销毁时作废在途请求并清除拖放状态。

`HvacPage.vue` 从 1571 行降至 1544 行。模板、样式、拖放位置、内机 ID、API 和服务端持久化语义保持不变。

## 3. 防回归契约

新增 5 项可执行测试，覆盖：

1. 拖放后按稳定内机 ID 提交乐观顺序；
2. 当前保存失败时恢复原顺序并显示错误；
3. 较早保存的迟到失败不能回滚较新的成功顺序；
4. 页面销毁后抑制迟到回滚和提示，并清除拖放状态；
5. 结构门禁禁止排序服务和编排函数回流到页面组件。

## 4. 验证与生产发布

- 前端 226 项测试全部通过，其中本批新增 5 项；类型检查、Vite 生产构建和依赖审计通过，0 个已知漏洞。
- 本地与生产 PWA 均为 128 项预缓存；Linux CI 为 129 项，构建成功。
- [PR #164](https://github.com/ivanzhao299/smart-control/pull/164)三项门禁全部通过；[PR CI 35624101328](https://github.com/ivanzhao299/smart-control/actions/runs/35624101328)与[主分支 CI 35624403441](https://github.com/ivanzhao299/smart-control/actions/runs/35624403441)均成功。
- 数据影响：无迁移，不改写 HVAC 目录、设备状态、场景、媒体或欢迎方案；只有操作员真实拖放时才沿用既有排序接口，测试使用内存服务替身，不连接生产或控制现场设备。
- [生产发布 35624403390](https://github.com/ivanzhao299/smart-control/actions/runs/35624403390)识别为 `frontendOnly=true`、`highRisk=false`，采用侧构建和零停机切换；无数据库备份、后端构建或服务重启。
- 两次只读迁移检查均为 `MIGRATIONS_CURRENT`；播放器首次恢复后，WireGuard 独立复验为 `PLAYER_RUNTIME_CURRENT slot=1 alive=true watchdog=enabled`。
- 内置媒体为 `BUNDLED_MEDIA_CURRENT 15`，Android 制品为 1.1.16（24）；权威发布清单记录 `17ba859151b00a592cdfb1f4e59b079536ae8b9e`，异机恢复包正确判定为不需要。
