# 公网直连远程访问 (erp.cnjinhu.top) — 开通与使用

> 2026-07-30 上线。目标: 手机/平板**不开 WireGuard、不关代理软件**, 直接用
> `https://erp.cnjinhu.top` 远程控制展厅。
> 链路: 手机 → 阿里云跳板机(123.57.220.65) nginx → 既有 WireGuard 隧道 → GK9000。

## 一、业主开通步骤 (一次性)

### 1. 跳板机上跑配置脚本 (约 2 分钟)

阿里云控制台 → ECS 实例 (123.57.220.65) → 「远程连接」(Workbench) → root 登录,
把仓库里 `deploy/aliyun-public-proxy.sh` 的**全部内容**粘贴进终端回车。

脚本自动完成: DNS/隧道自检 → 找/签 HTTPS 证书 → 写 nginx 反代 → 重载 → 自测。
全程幂等, 报错按提示补(最常见: 去阿里云 DNS 给 cnjinhu.top 加 `erp` A 记录 →
123.57.220.65, 然后重跑)。

### 2. 改掉默认密码 (公网暴露前必须!)

后台 → `/admin/system-branding` → 改密码板块:
- 业主侧密码 (原默认 `1234`) → 换 **8 位以上** 数字字母混合
- 管理员密码 (原默认 `jinhu888`) → 同样加强

改完所有已登录设备会被踢一次, 用新密码重新登录即可。

### 3. App / 浏览器接入

- App: 配置页「远程地址」填 `https://erp.cnjinhu.top` (现场地址 192.168.77.54 不动)
- 手机浏览器: 直接开 `https://erp.cnjinhu.top/control/`

## 二、安全设计 (已内置)

| 层 | 措施 |
|---|---|
| 传输 | 全程 HTTPS (letsencrypt 证书, 脚本自动续签) |
| 鉴权 | 全局鉴权门**默认开启** (2026-07-30 起): 除白名单外所有接口要业主/后台 token |
| 本机豁免 | GK9000 本机 loopback 请求免 token (kiosk 播放器/运维脚本/探针不受影响) |
| 登录防爆破 | 双层限流: backend 10 次/分钟/IP + nginx `limit_req` 10r/m |
| 危险端点 | admin-restart / admin-rebuild 仅限 GK9000 本机 loopback 调用 |

紧急排障可临时关鉴权门: GK9000 `backend/.env` 加 `CLIENT_AUTH_DISABLED=true` 后
重启 backend——**公网暴露期间严禁长期关闭**。

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
| 域名打不开 | 跳板机 `systemctl status nginx`; 阿里云安全组 80/443 |
| 502 | 跳板机 `ping 10.66.66.3` (WireGuard 断了 → `systemctl restart wg-quick@wg0`) |
| 登录报"请求过快" | 限流生效, 等 1 分钟; 频繁出现 = 有人在爆破, 查 nginx access log |
| App 连不上但浏览器能开 | App 远程地址是否带了 `https://` 前缀 |
