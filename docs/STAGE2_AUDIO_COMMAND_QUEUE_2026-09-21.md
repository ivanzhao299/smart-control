# 阶段 2：音频实时命令合并队列

> 日期：2026-09-21  
> 范围：P2-A11  
> 结论：输入增益与输出音量已共用同一套按通道串行的最新值队列，并完成生产发布；矩阵交叉点写入、静音渐变、背景音乐和配置编辑仍由页面编排，后续继续按行为边界收敛。

## 1. 问题与边界

`AudioPage.vue` 原有两套手写异步循环：输入增益一套、输出音量一套。两者都要求设备命令按通道串行，并在拖动很快时丢弃中间值、只发送最新等待值。重复实现使失败处理、重试和后续设备响应优化容易出现分歧。

本批新增 `frontend/src/features/latest-command-queue.ts`，只负责以下通用时序：

- 第一条命令立即发送，同一键同一时刻最多一条命令在途；
- 命令在途期间多次更新只保留最后一个值；
- 不同通道使用独立队列，互不阻塞；
- 命令失败后停止该通道并清除旧等待值；用户下一次操作重新启动队列；
- 成功和失败通过回调交还页面展示，队列不依赖 Vue、Element Plus 或设备服务。

输入增益继续即时更新 dB 文本并在失败时显示消息；输出音量继续清除或写入对应通道错误。设备 API、通道键、数值、zone 参数、立体声联动和调用入口均保持。`AudioPage.vue` 从 2148 行降至 2133 行，仍属于超大模块，本批不关闭页面整体拆分项。

## 2. 数据与发布边界

- 无数据库迁移，不读取或写入生产配置，不修改媒体文件。
- 回归测试使用受控 Promise，不连接生产设备，不发送设备命令。
- 发布范围为 `frontendCode=true`、`backendCode=false`、`highRisk=false`、`scope=frontend`。
- 生产执行前端旁路构建和原子切换，跳过数据库备份、后端构建与重启。
- 数据库只读门禁返回 `MIGRATIONS_CURRENT`，并保留上一代 45 个 PWA 兼容资源。

## 3. 自动验证

新增 5 项回归，覆盖：

1. 首值立即发送，同一通道在途期间只发送最后一个等待值；
2. 不同通道并行、各通道内部串行；
3. 每一条已下发成功值触发成功回调；
4. 失败命令触发错误回调、丢弃旧等待值，下一次入队可恢复；
5. `AudioPage` 必须由输入增益和输出音量共同消费共享队列，禁止两套手写状态重新出现。

验证结果：

- 前端 134 项测试全部通过；
- TypeScript 类型检查通过；
- 生产构建通过，生成 131 项 PWA 预缓存；
- 前端生产依赖审计无已知漏洞；
- 发布范围分类测试 3 项通过；
- [PR #130](https://github.com/ivanzhao299/smart-control/pull/130) 前后端 CI 全绿；合并后的[主分支 CI](https://github.com/ivanzhao299/smart-control/actions/runs/35563760603)再次全绿。

## 4. 生产证据

- 功能提交：`3ed534c`；合并提交：`6f21472ce1d567c5db9f0aa9f6c814c9fa8deb8d`。
- [生产发布任务](https://github.com/ivanzhao299/smart-control/actions/runs/35563760599)成功；日志记录 `frontendOnly=True`、`backendOnly=False`、`highRisk=False`。
- 发布跳过数据库备份、后端构建和重启；数据库迁移只读门禁返回 `MIGRATIONS_CURRENT`，健康检查首次通过。
- `/control/deployment-version.json` 记录运行提交 `6f21472ce1d567c5db9f0aa9f6c814c9fa8deb8d`、构建号 `cc0f6863-b6e4-41c8-925d-4b0671765aca`、`clean=true`。
- 公网 `/control/`、`/control/audio` 与健康接口返回 HTTP 200；健康数据中 API、数据库、WebSocket 和调度器均为 `up`。
- 当前 Service Worker 包含 131 个预缓存 URL，逐项请求全部返回 HTTP 200；音频页分块为 `assets/AudioPage-CxmPClkr.js`。
- LED 播放器运行门禁返回 `PLAYER_RUNTIME_RECOVERED slot=1 alive=true watchdog=enabled`；`verify-deploy.js`、15 项内置媒体和 Android 1.1.16 制品对账通过。

## 5. 后续边界

下一批优先为矩阵交叉点的“在途目标值覆盖、失败回滚、设备回读对账”建立行为测试，再决定是否复用同一队列或保留带乐观状态的专用状态机。静音渐变和背景音乐包含计时器、联动与持久化，必须独立建模，不能直接套用本批的最后值队列。
