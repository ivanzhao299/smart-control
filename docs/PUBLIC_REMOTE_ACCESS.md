# 公网直连远程访问 (erp.cnjinhu.top) — 开通与使用

> 2026-07-30 上线，2026-09-22 切换到新加坡 HTTPS 边缘入口。目标: 手机/平板**不开 WireGuard、不关代理软件**, 直接用
> `https://erp.cnjinhu.top` 远程控制展厅。
> 链路: 手机 → 新加坡边缘机(47.236.122.224) nginx → 北京跳板机
> (123.57.220.65:8443) → 既有 WireGuard 隧道 → GK9000。

## 一、业主开通步骤 (一次性)

### 1. 边缘入口与跳板机

`erp.cnjinhu.top` 的 A 记录固定指向 `47.236.122.224`，客户端统一使用标准
HTTPS 443。边缘机持有 `erp.cnjinhu.top` 证书，并把请求转给北京跳板机的
8443；8443 只作为两台服务器之间的上游端口，不再要求手机公网直连。

北京跳板机的反代仍由 `deploy/aliyun-public-proxy.sh` 维护；边缘机 nginx 配置
为 `/etc/nginx/conf.d/erp.cnjinhu.top.conf`。变更后必须依次验证 DNS、证书、
`/control/` 和 `/api/client-auth/ping`。

### 2. 建立个人账户 (公网暴露前必须)

后台 `/admin/users` 为每位使用者建立个人账号，按职责分配 admin、operator 或 viewer。
系统没有共享默认密码；全新数据库需先由运维使用一次性 provisioning 命令创建首个管理员。

### 3. App / 浏览器接入

- App: 配置页「远程地址」填 `https://erp.cnjinhu.top` (现场地址 192.168.77.54 不动)
- 手机浏览器: 直接开 `https://erp.cnjinhu.top/control/`

## 二、安全设计 (已内置)

| 层 | 措施 |
|---|---|
| 传输 | 全程 HTTPS (letsencrypt 证书, 脚本自动续签) |
| 鉴权 | 全局鉴权门**默认开启** (2026-07-30 起): 除白名单外所有接口要业主/后台 token |
| 本机访问 | 本机请求也必须提供用户、播放器或运维端点要求的专用凭据 |
| 登录防爆破 | 双层限流: backend 10 次/分钟/IP + nginx `limit_req` 10r/m |
| 危险端点 | admin-restart / admin-rebuild 仅限 GK9000 本机 loopback 调用 |

鉴权门无运行时关闭开关。播放器和运维探针使用各自的最小权限凭据，不能借用用户密码。

## 三、已知边界

- `/api/media/:id/file` 为免 token 白名单 (手机 `<img>/<video>` 无法带自定义
  header)——媒体文件知道 ID 即可读。敏感资料不要放媒体库; 后续可升级签名 URL。
- 云端 mock 演示站 (主域 `https://cnjinhu.top/control/`) 与 GK9000 无关, 数据是
  假的, 别混淆; erp 子域才是真机。
- 远程视频/大图加载受阿里云带宽限制, 比现场慢属正常。
- 每次部署 CI verify 会自动探公网链路 (`[公网直连]` 段), 远程排障先看 Actions 日志。

## 四、故障速查

| 症状 | 查什么 |
|---|---|
| 域名打不开 | A 记录应为 `47.236.122.224`; 检查边缘机 nginx 与 80/443 安全组 |
| 502 | 先查边缘机到 `123.57.220.65:8443`，再查北京跳板机到 `10.66.66.3` 的 WireGuard |
| 登录报"请求过快" | 限流生效, 等 1 分钟; 频繁出现 = 有人在爆破, 查 nginx access log |
| App 连不上但浏览器能开 | 更新到 iOS 2.1.8 / Android 1.1.17；远程地址应为 `https://erp.cnjinhu.top/control/` |
