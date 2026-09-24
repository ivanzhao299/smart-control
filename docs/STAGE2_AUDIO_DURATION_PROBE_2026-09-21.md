# 阶段 2：音频时长探测边界

> 日期：2026-09-21
>
> 范围：P2-A14
>
> 结论：VBR 音频的浏览器时长探测、远端 seek、超时和资源清理已从音频页面提取为可测试边界；播放 API、媒体地址和后端播放状态保持。

## 1. 根因与修正

旧页面直接创建 `Audio` 元素并监听元数据。VBR MP3 在 `loadedmetadata` 时可能先返回 `Infinity`；旧实现只消费一次 `durationchange`，如果第一次变化仍不是有限正数，探测只能等待超时。成功、错误和超时也可能分别进入完成函数，缺少显式的单次完成与统一监听器清理。

本批新增 `frontend/src/features/audio-duration-probe.ts`：

- 有限正时长立即完成；
- 非有限时长执行原有远端 seek，并持续监听后续 `durationchange`；
- 成功、媒体错误或 6 秒超时只允许一个结果提交；
- 所有出口统一取消计时器、移除监听器并释放媒体源；
- 页面只负责把原有同源媒体地址交给探测器，并继续用 P2-A13 的媒体 ID 与播放会话校验异步结果。

## 2. 数据与发布边界

- 无数据库迁移，不读写媒体、播放列表或生产配置，不操作任何设备。
- 自动测试注入假的音频元素和计时器，不访问网络、不加载真实媒体。
- 发布分类为 `frontendCode=true`、`backendCode=false`、`highRisk=false`、`scope=frontend`。
- 生产日志明确跳过数据库备份、后端构建和服务重启，只执行前端旁路构建与原子切换。

## 3. 自动验证

新增 5 项回归：有限元数据、连续非有限 VBR 变化、媒体错误单次完成、seek 被拒后的有界超时，以及页面必须消费共享探测边界。

- 前端 150 项测试全部通过；
- TypeScript 类型检查通过；
- 生产构建通过，Workbox 输出 131 项预缓存记录；
- 前端生产依赖审计无已知漏洞；
- 发布范围测试 3 项通过；
- [PR #137](https://github.com/ivanzhao299/smart-control/pull/137) 前后端 CI 全绿；合并后的[主分支 CI](https://github.com/ivanzhao299/smart-control/actions/runs/35574556849)再次全绿。

## 4. 生产证据

- 功能提交：`6e5376e`；合并提交：`6e320419afe567ad1b4af3ef31bfb631e2a7bd41`。
- [生产发布任务](https://github.com/ivanzhao299/smart-control/actions/runs/35574556855)成功；日志记录 `frontendOnly=True`、`backendOnly=False`、`highRisk=False`。
- 发布生成 131 项 Workbox 记录，保留上一代 45/91 个资源；`MIGRATIONS_CURRENT`、播放器恢复、`verify-deploy.js`、15 项内置媒体和 Android 1.1.16 制品对账均通过。
- `/control/deployment-version.json` 记录运行提交 `6e320419afe567ad1b4af3ef31bfb631e2a7bd41`、构建号 `a56a76c3-731d-4bad-82ec-b8022b84ff95`、`clean=true`。
- 公网首页、音频页、后台登录和健康接口返回 HTTP 200；API、数据库、WebSocket 和调度器均为 `up`。
- 当前 Service Worker 有 131 条记录、128 个唯一 URL；128 个唯一 URL 逐项返回 HTTP 200，音频页分块为 `assets/AudioPage-3VJo-ea7.js`。

## 5. 后续边界

预缓存中 `icons/pwa-512x512.png`、`icons/pwa-192x192.png` 和 `icons/app.svg` 各出现两次。当前重复项内容一致且未导致安装失败，但清单不是最小集合。下一批应修正 Vite PWA 的自动扫描与手工清单重叠，并增加唯一性回归，避免后续同 URL 不同 revision 演变为安装错误。
