# GK9000 中控主机 — 现场配置指南

> 金湖展贸中心智能控制系统 · 占美 GIADA GK9000 工控机 现场部署与系统配置
> 适用于: Windows 10 全新安装后的初始化配置
> 估时: 全套配置 2-3 小时 (含装软件 + 网络 + 安全 + 自启)
>
> 本文档是 [Sprint-01-Windows-部署.md](Sprint-01-Windows-部署.md) 的**前置**:
> Sprint-01 讲怎么把应用跑起来, 本文讲 Windows 系统怎么调到生产可用.

---

## 0. 实际硬件规格 (本项目装机版本)

| 项 | 规格 | 备注 |
| --- | --- | --- |
| **型号** | 占美 GIADA GK9000 (8 核工控机) | |
| **CPU** | Intel Core **i7-10750H** | 6 核 12 线程, 2.6-5.0GHz, Comet Lake-H |
| **内存** | 16 GB DDR4 | 后端 + 前端 build 并行无压力 |
| **存储** | 1 TB SSD | 数据库 + 日志够用 5+ 年 |
| **串口** | 6 × COM (RS232 / RS485) | 当前架构闲置, 应急备份用 |
| **网口** | **2 × 1Gbps RJ45** | 一个接设备网, 一个接管理网 |
| **USB** | ≥ 4 × USB 3.0 | 键鼠 / U 盘 / 应急调试 |
| **显示** | **2 × HDMI** + DP / VGA | **HDMI 1 → NovaStar VX1000** (LED 视频源) · HDMI 2 → 1080P 监控/调试显示器 |
| **操作系统** | Windows 10 (专业版以上, 不要家庭版) | 远程桌面要求 Pro 起步 |

---

## 1. Windows 10 初装清单 (空白系统从零开始)

### 1.1 Windows 版本要求

**必须**: Windows 10 **专业版** / **企业版** / **IoT LTSC** (任一)
**不行**: 家庭版 — 不支持远程桌面服务器、不支持组策略、自动更新无法关停

确认方法: `Win+R` → `winver`, 看 "Edition" 字段.

### 1.2 系统语言 / 时区

```powershell
# 时区改成北京
Set-TimeZone -Name 'China Standard Time'

# 验证
Get-TimeZone
```

中文显示 / 中文输入法: 按 Windows 设置 → 时间和语言 → 语言 → 添加中文 (简体, 中国).

### 1.3 关闭碍事的系统功能

**Windows Update 自动重启** (必须, 展会期间被强制重启会瘫):
```powershell
# 设置 → 更新和安全 → 高级选项
# - 暂停更新: 35 天 (最大值)
# 或用组策略 (Pro 版以上):
#   gpedit.msc → 计算机配置 → 管理模板 → Windows 组件 → Windows 更新
#   → 配置自动更新 → 已禁用
```

**用户账户控制 (UAC)** (建议降低, 避免 PM2 启动弹窗):
```powershell
# 设置 → 账户 → 更改用户账户控制设置 → 滑到倒数第二档 (不通知)
```

**屏幕保护程序 / 自动锁屏** (生产机必须关):
```powershell
# 设置 → 个性化 → 锁屏界面 → 屏幕超时设置
# - 屏幕: 永不
# - 睡眠: 永不
```

**Cortana / OneDrive / Edge 启动项** (减少自启程序):
```powershell
# 任务管理器 → 启动 → 禁用全部非必要项
```

### 1.4 自动登录 (开机不需输密码, PM2 才能起)

```powershell
# Win+R → netplwiz
# - 取消勾选 "要使用本计算机, 用户必须输入用户名和密码"
# - 输入两次密码
# 重启验证: 应该直接进桌面, 不弹登录界面
```

**安全提示**: 主机物理上锁在弱电机柜, 公司内网访问, 不直接连公网. 自动登录的风险可控.

---

## 2. 双网口规划与配置

### 2.1 接线方案

```
┌──────────────────────────────────────┐
│  GK9000 (D:\smart-control\)          │
│                                      │
│  NIC 1 (设备网)        NIC 2 (管理网) │
│  192.168.50.10          DHCP        │
│  无默认网关             默认网关     │
└─────┬────────────────────┬──────────┘
      │                    │
      ▼                    ▼
┌────────────┐       ┌──────────────┐
│ 弱电交换机  │       │ 公司 LAN      │
│ (现场设备网)│       │ (办公网/外网) │
└─────┬──────┘       └──────────────┘
      │
      ▼
   各种网关:
   ├─ USR-TCP232-410s (DALI) → 192.168.50.20
   ├─ NovaStar VX1000 (LED)  → 192.168.50.30
   ├─ Intel NUC (LED 播控)   → 192.168.50.31
   ├─ DSPPA MAG6816 (音响)   → 192.168.50.40
   └─ AUX CCM-270B (空调)    → 192.168.50.50
```

**关键**:
- **设备网完全离线**, 网关 / DNS 都不配, 杜绝勒索病毒走设备网横向感染
- **管理网走 DHCP**, 走外网, 用于 `git pull` 同步代码 + Tailscale 远程
- 平板浏览器访问 PWA: 通过设备网 IP `http://192.168.50.10:3000` (后续走 80 端口 Nginx)

### 2.2 Windows 双网卡静态配置

NIC 1 名字通常显示为 `以太网` 或 `Ethernet 1`, 物理标识在主机背面写着.

**用 PowerShell 设置 (管理员)**:

```powershell
# 1) 先查两个网卡的 InterfaceIndex
Get-NetAdapter | Select-Object Name, InterfaceIndex, MacAddress, Status

# 假设输出:
# Name        InterfaceIndex  MacAddress         Status
# ----        --------------  ----------         ------
# 以太网      11              00-1B-21-AA-BB-CC  Up    ← 假设这个接弱电(设备网)
# 以太网 2    14              00-1B-21-AA-BB-DD  Up    ← 这个接管理网

# 2) 把"以太网"配成设备网 (静态, 无网关)
New-NetIPAddress -InterfaceIndex 11 -IPAddress 192.168.50.10 -PrefixLength 24
# 注意: 不要加 -DefaultGateway 参数!

# 3) "以太网 2" 走 DHCP (一般默认就是, 跳过即可)
# 如果要手动设 DHCP:
Set-NetIPInterface -InterfaceIndex 14 -Dhcp Enabled

# 4) 重要: 调整路由 metric, 让"管理网"成为默认出口
# Windows 默认 metric 是按链路速度自动算, 双千兆口时可能两个都是默认路由, 冲突
Set-NetIPInterface -InterfaceIndex 11 -InterfaceMetric 50    # 设备网, 高 metric (低优先)
Set-NetIPInterface -InterfaceIndex 14 -InterfaceMetric 10    # 管理网, 低 metric (高优先)

# 5) 验证
ipconfig /all
route print -4
```

**期望路由表**:
```
0.0.0.0/0    →  管理网网关 (如 192.168.1.1)  metric=10  ← 出外网走这个
192.168.50.0/24 → 直连  metric=50           ← 设备网直接走
```

### 2.3 命名重命名 (运维省心)

```powershell
# 把网卡改成有意义的名字
Rename-NetAdapter -Name '以太网' -NewName 'DeviceLAN'
Rename-NetAdapter -Name '以太网 2' -NewName 'MgmtLAN'

# 之后 ipconfig 看到的就是 DeviceLAN / MgmtLAN, 不会再搞错
```

### 2.4 验证连通性

```powershell
# 设备网 (期望通)
ping 192.168.50.20    # USR-TCP232 转换器
ping 192.168.50.30    # NovaStar VX1000
ping 192.168.50.50    # 空调网关 CCM-270B

# 外网 (期望通, 走管理网)
ping github.com
ping 8.8.8.8

# 关键: 设备网不应该能访问外网
# (从设备网网段, 192.168.50.x 子网内的设备 ping 不通外网 — 这是好事)
```

---

## 3. Windows 防火墙规则

只放行必要端口, 默认拒绝其他.

```powershell
# 后端 API (3000), 仅设备网允许
New-NetFirewallRule -DisplayName 'smart-control API (3000)' `
  -Direction Inbound -Protocol TCP -LocalPort 3000 `
  -Profile Private,Domain -Action Allow

# Nginx (80), 仅设备网允许 — 平板访问 PWA
New-NetFirewallRule -DisplayName 'smart-control Web (80)' `
  -Direction Inbound -Protocol TCP -LocalPort 80 `
  -Profile Private,Domain -Action Allow

# 远程桌面 (3389), 仅管理网允许
# 已默认存在, 改 profile:
Get-NetFirewallRule -DisplayName '远程桌面*' | Set-NetFirewallRule -Profile Private,Domain

# WebSocket 走 3000 端口同协议, 不用额外开

# 公网 profile 全部 deny (公司 LAN 当 Private 处理)
Set-NetFirewallProfile -Profile Public -DefaultInboundAction Block
```

**网络位置标定**:
- 把"设备网"标为 **专用网络**
- 把"管理网"标为 **专用网络** (公司 LAN 受信)
- 不要标 "公用网络"

```powershell
Set-NetConnectionProfile -InterfaceAlias 'DeviceLAN' -NetworkCategory Private
Set-NetConnectionProfile -InterfaceAlias 'MgmtLAN'   -NetworkCategory Private
```

---

## 4. 远程桌面 (mstsc)

```powershell
# 1) 启用 RDP 服务
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server' `
  -Name 'fDenyTSConnections' -Value 0

# 2) 启用网络级身份验证 (NLA, 更安全)
Set-ItemProperty -Path 'HKLM:\System\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' `
  -Name 'UserAuthentication' -Value 1

# 3) 允许 RDP 通过防火墙
Enable-NetFirewallRule -DisplayGroup '远程桌面'

# 4) 限定只能从管理网入站 (防止设备网渗透)
Get-NetFirewallRule -DisplayGroup '远程桌面' | Where-Object Direction -eq 'Inbound' | `
  Set-NetFirewallRule -Profile Domain  # 仅域网络/Tailscale

# 验证 RDP 监听
netstat -an | findstr :3389
```

**从工程师笔记本登录**: `mstsc → <管理网 IP 或 Tailscale IP>` → 当前 Windows 账号.

---

## 5. Tailscale (远程维护方案)

GK9000 装 Tailscale, 工程师从办公室直连, 无需 VPN.

```powershell
# 1) 下载安装
# https://tailscale.com/download/windows
# 直接下 .exe 运行, 用浏览器扫码加入公司 Tailnet

# 2) 让 Tailscale 仅走管理网 (不污染设备网)
# Tailscale GUI → Settings → Use Tailscale exit nodes: 关闭
# 这样设备网完全不知道 Tailscale 存在
```

加入 Tailnet 后, 主机获得一个 `100.x.x.x` 的 Tailscale IP, 工程师笔记本在同一个 Tailnet 里就能 ping / RDP / SSH 这个 IP (公网通路).

---

## 6. 软件栈安装

按 [Sprint-01-Windows-部署.md](Sprint-01-Windows-部署.md) §1.1-1.5 完成:

- Node.js 20 LTS (勾选 Add to PATH)
- pnpm + PM2 + pm2-windows-startup
- Git for Windows
- (可选) Visual Studio Code — 现场调试 .env / 看日志方便

额外推荐:
- **Modbus Poll** (寄存器调试, [HVAC_FIELD_INSTALL.md](HVAC_FIELD_INSTALL.md) §6 要用)
- **Wireshark** (抓包排错, 走转换器时看 502 端口)
- **PuTTY** (串口调试 — 6 COM 口闲置但万一要用)

**LED 大屏视频播放相关 (本机兼任播控, 不要单独 NUC)**:
- **诺瓦 ViPlex Express** (NovaStar 官方播控软件, 跟 VX1000 配套)
- **PotPlayer** 或 **VLC** (备用通用播放器, 支持全屏 + 循环 + 命令行控制)

> GK9000 的 **HDMI 1 输出接 NovaStar VX1000** 作为 LED 视频源.
> 视频文件存 `D:\Media\`, 由 ViPlex Express 或 PotPlayer 全屏播放.
> 详见 §11 "LED 视频播放配置" 节.

---

## 6.5 LED 视频播放配置 (本机兼任 LED 播控)

由于 GK9000 自带 2 个 HDMI 输出, **不需要独立 NUC 播控主机**. 直接用 GK9000 输出 LED 视频信号给 VX1000.

### 接线

```
GK9000 HDMI 1 ────HDMI 线 ────→ NovaStar VX1000 HDMI 输入 1
GK9000 HDMI 2 ────HDMI 线 ────→ 1080P 监控显示器 (调试 + 远程协助看屏)
```

### Windows 显示设置

1. Windows 设置 → 系统 → 显示
2. 多显示器 → 选 "**扩展这些显示器**" (不要"复制", 因为大屏分辨率跟监控显示器不同)
3. **HDMI 1 (大屏)** 设为分辨率 = LED 模组实际拼接像素 (例 `1920×1080` 或 `2560×1440`, 跟 VX1000 配套确认)
4. **HDMI 2 (监控屏)** 设为 `1920×1080`
5. 排列: 监控屏放主屏 (Windows 任务栏在这里), 大屏放扩展 (右侧或顶部, 按物理位置)

### 视频文件管理

| 项 | 路径/约定 |
| --- | --- |
| 视频文件根目录 | `D:\Media\` |
| 欢迎视频 | `D:\Media\welcome\` (例 `welcome.mp4` 循环播放) |
| 路演视频列表 | `D:\Media\roadshow\` |
| 企业宣传 | `D:\Media\corporate\` |
| 节假日特殊素材 | `D:\Media\holiday\` |

视频上传方式:
- **U 盘拷贝** (最简单, 现场插)
- **远程桌面拖拽** (工程师 RDP 进来后拖文件)
- **共享文件夹** (开个 D:\Media SMB 共享, 网内任意电脑都能上传)

### 播放软件 (二选一, 推荐 ViPlex Express)

**方案 A — 诺瓦 ViPlex Express** (推荐):
- 跟 VX1000 同厂, 兼容性最好
- 支持播放列表、定时、节目模板
- 安装: 从诺瓦官网下载 ViPlex Express
- 配置: 把 D:\Media 添加为素材库, 创建 2 个节目 (欢迎页 + 视频列表) 分别对应 VX1000 预设 1/2

**方案 B — PotPlayer / VLC** (兼用):
- 简单粗暴, 全屏循环播放
- PotPlayer 命令行: `PotPlayerMini64.exe /fullscreen /loop D:\Media\welcome.mp4 /open_on_monitor=1`
- VLC: `vlc --fullscreen --loop --no-video-title-show D:\Media\welcome.mp4`
- 适合简单循环需求

### 启动时自动播放

把播放命令做成 `D:\smart-control\scripts\start-led.bat`, 加入 Windows 启动项 (`shell:startup`), 开机后自动全屏播放欢迎视频.

### 中控代码对接

后端 `nova-led.adapter.ts` 当前控制 VX1000 (开屏/关屏/切预设/切输入), **不直接控本机播放器** (播放器一直在循环播视频). 切场景时:
- 后台 "showWelcome" → VX1000 调预设 1 (本机播放器要提前播好欢迎视频)
- 后台 "playMedia" → VX1000 调预设 2 (本机播放器播视频列表)

未来需要平板远程"换视频列表", 可加 VLC HTTP API 控制 (后端调 `http://localhost:8080/requests/status.xml?command=in_play&input=...`).

---

## 7. PM2 开机自启 (生产关键)

[Sprint-01](Sprint-01-Windows-部署.md) §3.3 已述, 这里补一个**生产铁律**:

```powershell
# 装完 PM2 + 启动应用后必须执行:
pm2 save
pm2-startup install

# 重启验证 (谨慎!):
shutdown /r /t 0

# 重启后:
pm2 list    # smart-control-backend 应自动 online
```

**如未自启** (常见坑):

```powershell
pm2-startup uninstall
pm2 kill
pm2 start ecosystem.config.js   # 重新启动应用
pm2 save
pm2-startup install
```

---

## 8. Nginx 反代 (可选, Sprint-10 已有配置)

按 [DEPLOY_WINDOWS.md](../DEPLOY_WINDOWS.md) §2 配 Nginx, 把 80 端口反代到后端 3000.

平板访问简化为 `http://192.168.50.10/`, 不用带 `:3000`.

---

## 9. BitLocker 磁盘加密 (推荐)

数据库里有场景配置 + 日志, 万一硬盘被偷至少加密保护一下.

```powershell
# 系统盘 (C:) 加密
Enable-BitLocker -MountPoint 'C:' -EncryptionMethod XtsAes256 `
  -UsedSpaceOnly -SkipHardwareTest -RecoveryPasswordProtector

# 项目盘 (D:) 加密 (有 smart-control 数据库)
Enable-BitLocker -MountPoint 'D:' -EncryptionMethod XtsAes256 `
  -UsedSpaceOnly -SkipHardwareTest -RecoveryPasswordProtector

# 重要: 恢复密钥务必备份到云盘 / 公司密保, 不能只放本机!
manage-bde -protectors -get C:
manage-bde -protectors -get D:
```

---

## 10. 6 个 COM 口 (当前闲置, 留档)

GK9000 自带 6 个 RS232/RS485 接口. 当前架构走 USR-TCP232 转换器, COM 口未使用. 留作应急备份.

```powershell
# 看系统识别到几个 COM
Get-WmiObject -Class Win32_SerialPort | Select-Object DeviceID, Name, ProviderType
```

应急场景 — **USR-TCP232 转换器挂了, 现场没备件**:
1. 拔下 USR-TCP232 上 RS485 三根线 (A+/B-/GND)
2. 接到 GK9000 的 COM 口 (RS485 模式)
3. 临时修改后端配置, 把 DALI 适配器从 `modbus-rtu-over-tcp` 切换到 `modbus-rtu-over-serial`

> 该应急方案目前**没有写代码** (适配器只支持 TCP), 真要走这条路需 2-3 小时改造串口传输层. 现场风险足够高时再改, 平时不必做.

---

## 11. 验收清单 (装机后逐项核对)

- [ ] Windows 10 专业版/企业版/LTSC, 已激活
- [ ] 时区 China Standard Time, 时间准确
- [ ] 自动登录已开 (重启不弹密码)
- [ ] 屏幕永不睡眠 / 永不熄屏
- [ ] Windows Update 已暂停 35 天 (或组策略禁用)
- [ ] UAC 降到倒数第二档
- [ ] NIC 1 (DeviceLAN) = 192.168.50.10/24, 无网关, metric=50
- [ ] NIC 2 (MgmtLAN) = DHCP, 默认网关到外网, metric=10
- [ ] `ping 192.168.50.20` 通 (USR-TCP232)
- [ ] `ping github.com` 通 (走 MgmtLAN)
- [ ] 防火墙: 3000 / 80 入站允许 (Private), 3389 仅 MgmtLAN
- [ ] 远程桌面启用, NLA 开
- [ ] Tailscale 已加入 Tailnet, IP 100.x.x.x 通
- [ ] Node.js 20 LTS / pnpm / PM2 / pm2-windows-startup 全装
- [ ] Modbus Poll 装好
- [ ] `D:\smart-control\` clone 成功, `.env` 按现场改好
- [ ] `.\scripts\start.ps1` 成功, `pm2 list` 显示 online
- [ ] `pm2 save` + `pm2-startup install` 执行过
- [ ] 重启一次主机, 自动登录 + PM2 自动起 + 服务自动 online
- [ ] 平板浏览器访问 `http://192.168.50.10/` 看到登录页 (Nginx 配好后)
- [ ] BitLocker 加密 C: 和 D:, 恢复密钥已备份到公司密保

---

## 12. 常见问题

**Q: 装完 Tailscale 后, 设备网 192.168.50.x 路由乱了?**
A: Tailscale 会注册 100.64.0.0/10 路由. 不影响 192.168.50.x 直连. 如果异常, 检查 `route print -4`, 删除可疑路由项.

**Q: 重启后 PM2 没自动起?**
A: 99% 是自动登录没配, PM2 必须在用户会话里才能启动. 跑 `netplwiz` 确认勾选去掉.

**Q: 现场调试时只插了管理网, 设备网 (NIC 1) 没线 — 服务能起来吗?**
A: 能起, 但所有 device adapter 会显示 offline. 看 `pm2 logs` 会满屏 connection refused. 现场必须插好两根网线.

**Q: 双千兆口跑 1Gbps 数据流够吗?**
A: 我们的 Modbus / TCP 流量每秒不到几 KB, 千兆口跑这负载只用 0.001%. 完全不是瓶颈.

**Q: i7-10750H 跑这点东西, CPU 负载会不会过低反而散热不良?**
A: 不会. 工控机 BIOS 会按负载动态降频, 长期低载会进 C-state, 风扇低速. 反而比满载更省心.

**Q: 1TB SSD 够用多久?**
A: 数据库 (含 7 类 entity, 日均 1000 操作日志) 估算每年增长 < 500MB. 1TB 撑 50 年. 主要消耗在日志 (`backend/logs/`) 上, 当前配置 14 天滚动, 也很小.

---

## 13. 相关文档

| 文档 | 作用 |
| --- | --- |
| [Sprint-01-Windows-部署.md](Sprint-01-Windows-部署.md) | 应用部署 (Node + PM2 + 启动) |
| [DEPLOY_WINDOWS.md](../DEPLOY_WINDOWS.md) | 完整部署手册 (Sprint-10 体系) |
| [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) | 上线 44 项检查清单 |
| [WINDOWS_MAINTENANCE.md](../WINDOWS_MAINTENANCE.md) | 日常运维 |
| [ONSITE_UPDATE.md](ONSITE_UPDATE.md) | 现场代码同步流程 |
| [DALI_FIELD_INSTALL.md](DALI_FIELD_INSTALL.md) | DALI 现场施工 |
| [HVAC_FIELD_INSTALL.md](HVAC_FIELD_INSTALL.md) | 空调现场施工 |
| [AUDIO_FIELD_INSTALL.md](AUDIO_FIELD_INSTALL.md) | 音响现场施工 |
