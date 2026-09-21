# 阶段 2：音频矩阵命令状态机

> 日期：2026-09-21  
> 范围：P2-A12  
> 结论：矩阵交叉点的快速连点、最新值合并、乐观显示和设备确认回滚已从页面提取为专用控制器并发布生产；矩阵 API、真实回读、防抖对账和轮询策略保持。

## 1. 根因与修正

旧 `toggleMatrix` 在页面内维护目标值 `Map`、在途 `Set`、发送循环、错误回滚和对账计数。它能合并快速连点，但整轮循环只保存第一次点击前的 `before`：

1. 交叉点初始为关；
2. 第一次点击“开”成功，设备已确认开；
3. 在途期间的第二次点击“关”随后失败；
4. 旧代码仍回滚到整轮开始的“关”，短时间显示与设备真实“开”相反，直到回读完成才纠正。

本批新增 `frontend/src/features/audio-matrix-command-controller.ts`。控制器把设备回读和每条成功命令记录为“已确认状态”，失败只回滚到最后一次确认值，同时继续触发设备真实回读。它复用共享 latest-command queue；队列增加 `onStart`/`onIdle` 生命周期，使页面仍能精确维护全局写入计数，并在一批写入结束后执行 1.2 秒防抖对账。

页面不再直接维护 `desiredCross` 和 `inFlightCross`。矩阵 API、输出/输入通道参数、错误文本、8 秒轮询和设备回读接口均保持。

## 2. 行为不变量

- 点击后立即乐观更新，不等待约 300ms 的硬件往返。
- 同一交叉点同时最多一条命令在途，等待区只保留最后一次点击。
- 不同交叉点仍可各自排队；后端适配器继续负责设备级串行。
- 首条失败时丢弃未发送旧值，恢复最近设备快照并立即回读。
- 前一条成功、后一条失败时恢复前一条成功值，不恢复整轮开始前的过期值。
- 正常完成和失败都只产生一次活跃周期结束事件，`pendingWrites` 不泄漏。

## 3. 数据与发布边界

- 无数据库迁移，不读写生产配置或媒体，不改变 SQLite 权威源。
- 自动测试使用受控 Promise，不访问网络、不连接 EKX-808、不发送现场命令。
- 发布分类为 `frontendCode=true`、`backendCode=false`、`highRisk=false`、`scope=frontend`。
- 生产执行前端旁路构建和原子切换，跳过数据库备份、后端构建与重启。
- 数据库只读门禁返回 `MIGRATIONS_CURRENT`，上一代 45 个 PWA 资源继续保留。

## 4. 自动验证

本批新增 6 项回归：

1. 快速三次点击只保留最后一个等待值；
2. 第一条成功、后一条失败时回滚到最后确认值；
3. 第一条失败时丢弃等待值并恢复设备快照；
4. 新设备快照成为下一次失败回滚的权威值；
5. 页面必须消费矩阵控制器，禁止旧 `Map`/`Set` 循环回流；
6. 合并发送整轮只触发一次 `onStart` 和一次 `onIdle`。

验证结果：

- 前端 140 项测试全部通过；
- TypeScript 类型检查通过；
- 生产构建通过，生成 131 项 PWA 预缓存；
- 前端生产依赖审计无已知漏洞；
- 发布范围测试 3 项通过；
- [PR #132](https://github.com/ivanzhao299/smart-control/pull/132) 前后端 CI 全绿；合并后的[主分支 CI](https://github.com/ivanzhao299/smart-control/actions/runs/35568920122)再次全绿。

## 5. 生产证据

- 功能提交：`7d402ad`；合并提交：`b5ba178a6e793643ee0e5b9463b569642dffa13a`。
- [生产发布任务](https://github.com/ivanzhao299/smart-control/actions/runs/35568920076)成功；日志记录 `frontendOnly=True`、`backendOnly=False`、`highRisk=False`。
- 发布跳过数据库备份、后端构建和重启；健康检查首次通过，数据库门禁为 `MIGRATIONS_CURRENT`。
- `/control/deployment-version.json` 记录运行提交 `b5ba178a6e793643ee0e5b9463b569642dffa13a`、构建号 `bafeef41-88c9-4e1b-b71d-f7a469b17cba`、`clean=true`。
- 公网首页、音频页、后台登录和健康接口返回 HTTP 200；API、数据库、WebSocket 和调度器均为 `up`。
- 当前 Service Worker 的 131 个预缓存 URL 逐项返回 HTTP 200；音频页分块为 `assets/AudioPage-CWECNDpu.js`。
- `PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled`、`verify-deploy.js`、15 项内置媒体与 Android 1.1.16 制品对账全部通过。

## 6. 后续边界

音频页仍包含背景音乐计时器、播放列表用例、静音渐变和配置编辑。下一批应优先提取背景音乐播放状态或静音渐变状态机，并保留播放通道数据库状态、浏览器计时和设备音量命令之间的明确边界。
