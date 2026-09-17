# 前端发布通知与播放器缓存恢复

## 发布触发规则

1. Vite 每次构建生成 `frontendBuildId`，同时嵌入页面代码并输出到 `deployment-version.json`。
2. 标准部署通过验证后，才将实际产物的标识原子写入仓库外 `release.json`。仅构建、失败部署和 VerifyOnly 均不发布通知。
3. 后端监听该目录的文件变更（不是每分钟轮询）。只有前端标识变化才通过现有已认证 WebSocket 发出 `frontend_release`；不新增连接，不扩大设备权限。
4. 设备和普通用户的连接握手都带上当前已发布标识，解决离线期间错过通知的问题。
5. 页面发现与自身不同的版本时，先以 no-store 获取同源产物标识。匹配后更新 Service Worker，激活成功后刷新；不支持 Service Worker 的 HTTP 局域网页面直接刷新。

空闲时没有应用级版本轮询。原有业务心跳仍保留。失败只做有限重试，恢复网络/前台或重新握手可再次核对。每个目标版本有刷新防循环保护。

后端或文档单独发布保留原前端标识，不触发页面更新。按现有最小发布规则，纯静态文件复制不重新构建，也不会生成新标识；若要求所有客户端同步加载这类变更，应将其纳入一次前端构建发布，不能把普通文件复制冒充已构建的新版。

首次上线：旧客户端不认识新通知，应先通过其原有更新机制或既有交互式播放器 watchdog 加载本次版本。不要通过 SSH Session 0 启动 GUI，也不要删除持久登录存储。首次部署涉及后端重启，现有启动即待机规则仍然保留。

## 缓存路径

启动与恢复统一使用 `scripts/player-profile-path.ps1`，配置目录为：

`%LOCALAPPDATA%\smart-control-player-slot<N>`（N=1、2、3）

只清理该目录下 Default 的 Service Worker、Cache、Code Cache、GPUCache，以及根目录的 GPUCache、ShaderCache、GrShaderCache。不清理普通 Edge/Chrome 配置，不清理 Cookies、Local Storage、Session Storage、IndexedDB、Preferences 或设备凭据文件。

仍有播放器进程时拒绝清缓存；遇到链接/目录联接或删除错误时明确失败，不再报告虚假的“已清理”。常规版本更新不依赖清缓存，这个脚本用于播放器启动/恢复。

## 验证

- 前端行为测试覆盖空闲零轮询、同版本忽略、推送/重连、有限重试、HTTP 无 SW、异步安装失败、防刷新循环及清理监听器。
- 后端测试覆盖原子替换监听、仅已验证发布触发、重复标识去重、无效清单保留旧值及设备撤权。
- `backend/test/fixtures/player-cache.ps1` 在临时目录执行真实清理，验证登录存储、其他通道和个人配置完整，并拒绝目录联接。生产资料不用于破坏性测试。
