# MEMORY — 会话记忆（新对话从这里接力）

> **用途**：跨对话无缝接力的唯一记忆文件。每次工作会话结束（或状态有变）都更新这里。
> 新对话开场只需说一句："**读 MEMORY.md，继续当前任务**"。
> 长期工程知识（架构/部署坑/铁律）在 `CLAUDE.md`；故障档案在 `docs/INCIDENTS.md`；
> 历史时间线在 `docs/PROGRESS.md`。本文件只放**当前状态与进行中的事**。

## 当前状态快照（2026-07-28）

- **生产**：GK9000 上 backend(3200)+frontend(5173) 由 pm2 守护，三路 kiosk 心跳正常，近期部署全绿。设备未上电时网关 offline 属正常。
- **PWA**：v6.5 视觉（纯白主文字/小字号+1px/卡片提亮）、切页无展开感、掉线弹窗 8s 复核防误踢、chunk 失败自愈、令牌跨重启存活（HMAC 签名制）——全部已上线。
- **Android**：v1.1.3 内网自动分发链全通（CI 固定签名 → APK 自动入库 → GK9000 `/api/app/android/download` → 终端弹更新）。注意：签名切换版，终端**首次需卸载旧版再装**。
- **iOS**：v1.1.3 TestFlight 全自动链全通，构建 #14/#15 已上传并挂入「内部测试」组（五关攻略见 PROGRESS 阶段五：Admin 密钥/归档免签/导出云签/macos-26/出口合规豁免）。

## 进行中 / 待办（按优先级）

1. **iOS TestFlight 邀请失效排查**（卡在最后一步）：业主 iPhone 点邀请邮件报
   "invitation revoked or invalid"。已指导：ASC → 内部测试组 → 测试员 → 重发邀请，
   点**最新**邮件；仍失效则核对 iPhone 登录的 Apple ID 是否 = 测试员邮箱
   （344066039@qq.com），不一致就把实际 Apple ID 邀请为 ASC 用户再加入测试组。
   等业主反馈结果。
2. **后台 "APP 版本管理 → ios" downloadUrl 待配**（TestFlight 跑通后填邀请链接）。
3. **旧 App Store Connect API 密钥待撤销**（名称 CI、App 管理角色、ID 8K53TVACBJ）——
   新的 Admin 密钥已验证可用，业主随时可去 ASC 撤旧钥。
4. **App Store 公开上架待业主决策**：有 4.2 套壳 + 2.1 审核员连不上内网的被拒风险；
   若做：公网 MOCK 演示服务器 + 隐私政策页 + 截图文案，陪审核迭代。
5. **共享展厅多租户（业主 2026-07-28 提出，规划中）**：把欢迎页编辑/内容上传开放给
   园区企业用户——用户端分配账号登录，各企业上传自己的可播放内容，实现共享展厅。
   涉及：账号体系（企业租户表+按租户隔离的媒体库配额）、内容审核流（业主审批后
   才可上屏）、播放排期（各企业时段）、现有单密码客户端鉴权升级为多账号。
   动工前先和业主对清权限模型与审核流程。
6. **第二台电源时序器（55…AA 6字节协议）待到货**：驱动已预写好（4a1f0c1，
   seq55-protocol + Seq55Adapter + 路由，10 项例帧金标准单测）。到货三步启用：
   ①接独立串口（9600，不能与 EPO-802P 的 COM1 共线）②后台建 power-seq55
   硬件填串口号 ③加 8 路回路挂它。⚠️ 面板电源按键须置关才受控；读状态回帧
   格式厂家未给——到货发 FA 抓包后补解析，先只控不读。
7. **涂鸦智能接入（规划）**：方案已给业主（云 OpenAPI 快速落地 / tuyapi 局域网
   直控 / zigbee2mqtt 三路线）。等业主确认：设备类型数量、涂鸦账号、开放平台注册。
7b. **百度网盘联调待业主注册**：功能已交付（403a6ae，媒体页「百度网盘」按钮：
   AppKey/SecretKey 配置 → 设备码授权（手机输码）→ 浏览/服务器代下载入库，
   流式落盘 2GB 上限单并发）。等业主到 pan.baidu.com/union 注册个人开发者建应用、
   把 AppKey/SecretKey 填进弹窗并完成一次手机授权即可用。⚠️ 非会员 dlink 限速。
   **隐私双收紧已上线（0f5f9f9，2026-07-30）**：①全部接口 AdminGuard 仅管理员，
   弹窗遇 401/403 就地验证后台密码；②rootPath 可见根目录（迁移 1785190000000+
   自愈），list 越界钳回、download 按 filemetas 真实路径校验防越权 fsId；
   浏览条「根目录」设置入口+未设置黄条提醒。建议业主再用专用小号授权=三保险。
8. 真电表 DDS866 接入（power adapter 仍 Mock，框架已备）。
9. 1F DALI 网关 L2 Modbus 超时（待现场硬件排查）。
10. 电源时序器接入情景模式场景引擎（业主未要求，暂缓）。

## 最近一次会话纪要（2026-07-29）

- 百度网盘弹窗卡「读取状态…」修复（fb7b556）：根因=状态接口请求失败时前端
  只存不显报错、轮询也不重试状态，永久卡住。修：报错文字可见+「重试」按钮+
  2s 自动重读；建表默认值改 CURRENT_TIMESTAMP（迁移+自愈双处）+自愈失败打
  warn；verify-deploy.js 加 /api/baidu-pan/status 探针。**探针实测生产端该接口
  健康（configured=false）**——业主端卡住是客户端侧（缓存/网络），杀 App 重开
  （或 v1.1.5 清缓存）后重试，再报错会直接显示具体原因。AppKey 还没填进生产。
  业主随后截图报错=「timeout after 15000ms」→ 定性为远程 WireGuard 慢链路
  （媒体页缩略图占满并发连接，状态请求排队超时）；百度网盘全部请求超时已放宽
  30s；已建议业主在现场 WiFi 完成一次性配置+授权。
- **公网直连方案实施中（2026-07-30 业主拍板）**：复用交接文档里已有的
  erp.cnjinhu.top HTTPS 域名（阿里云跳板机 nginx → WireGuard → GK9000）。
  已交付：①全局鉴权门默认重开（07-24 关门原因已被令牌签名制根治；新增本机
  loopback 豁免保 kiosk/watcher/探针；紧急关闭开关改为 CLIENT_AUTH_DISABLED=true）
  ②跳板机幂等配置脚本 deploy/aliyun-public-proxy.sh（DNS/隧道自检+证书复用或
  certbot 签发+反代 5173//api//ws/+登录 nginx 限流第二层）③verify 探针加
  [公网直连] 段（GK9000 出公网绕回自己测 erp 全链路）④docs/PUBLIC_REMOTE_ACCESS.md
  业主手册。登录限流 backend 侧本来就有（10 次/分/IP）；admin-restart 等危险端点
  本来就是 loopback-only。a1cd30f 部署绿：**鉴权门已在生产生效**，kiosk 心跳/
  探针/watcher 全正常（loopback 豁免起效）。探针实测 erp.cnjinhu.top
  **DNS 记录不存在**（ENOTFOUND；主域正常）。**待业主动作**：①阿里云 DNS 给
  cnjinhu.top 加 A 记录 erp→123.57.220.65 ②跳板机粘 deploy/aliyun-public-proxy.sh
  跑一次 ③后台改掉 1234/jinhu888 默认密码 ④App 远程地址换 https://erp.cnjinhu.top。
  ⚠️ 若业主报"没有权限操作"=某流程没带 token 撞上新鉴权门，紧急兜底
  CLIENT_AUTH_DISABLED=true，查明后再开。
  **联调进展（07-30 下午）**：业主已加 DNS(erp→123.57.220.65 已全网生效)并跑通
  反代脚本——本机自测 API 吐 JSON=nginx→WG→GK9000 回程全通。但公网 80/443 被
  阿里云**未备案拦截**坐实（certbot HTTP 验证收到拦截页 403；443 是 SNI RST）→
  路线改为：acme.sh DNS 验证签证书（deploy/aliyun-erp-cert-dns.sh，业主已跑完
  AccessKey+签发两步）+ 8443 端口（拦截不看非标口）。前端页 403 根因=vite
  preview 只在进程启动读配置、部署链从不重启前端 → allowedHosts(.cnjinhu.top)
  落盘没生效；update.ps1 已加 vite.config 哈希戳记检测（9fba3df）。**403 已根治
  （ee06061 体检确认 5173 带 erp Host 返 200）**——最终根因=pm2 restart 不真换
  进程（项目已知陷阱），改 delete+start 后生效；排查中顺手交付：verify 探针
  vite 配置遮蔽取证+隔离实验（现场拉新 preview 对照）、deploy-from-ci git fetch
  竞态重试（70f7055）。业主侧证书第一次失败=AccessKey 缺 AliyunDNSFullAccess
  （Error adding TXT record），已给 RAM 授权指引。**剩余（全在业主）**：
  ①RAM 授权修好重跑证书脚本 ②重跑反代脚本(切 443+8443) ③安全组放行 8443。
  **公网直连已实测跑通（07-30 业主截图实证：手机不开 WG 从
  https://erp.cnjinhu.top:8443 加载出登录页）**。注意：GK9000 出站探针对
  erp/裸IP:8443 仍报 ECONNRESET（出口方向误报，疑似 GK9000→跳板机公网口
  的回环/出口限制），以手机实测为准，探针结果对此域不可靠。
  后续交付：v1.1.6 双端（默认远程地址=erp:8443，APK/IPA 全绿）；后台
  「重置业主端密码」入口补上（原来只有接口没 UI）；登录页删默认密码提示；
  PWA baseURL 页面 origin 优先（现场自动直连提速）；浅色对比度二轮加深
  （8c49c5d）。**图标已换新（a8c89c1，v1.1.7 四流水线全绿）**：业主选定
  "企业 logo 保形换色方案②"——logo 图形不动，主漩涡换冰蓝渐变+叶簇转金、
  深夜蓝底、92% 铺满；覆盖 Android 全 dpi/round/自适应+背景色、iOS AppIcon、
  PWA 图标、brand-logo.png（透明底新色，登录页默认 logo）。透明底新 logo
  已发业主（可上传后台品牌页覆盖自定义 logo）。**待办**：业主改两个默认
  密码（1234/jinhu888，入口已补）；治本 ICP 备案（通过后 443 去端口号）。
  ⚠️ 媒体文件 /api/media/:id/file 仍免 token（img 标签带不了 header），敏感资料
  别放媒体库，后续可做签名 URL。

- App 连接体验三连改交付（0c3b935，双端 v1.1.4）：①连接中文字换 logo 呼吸+蓝弧
  动画（iOS/Android 都有，Android 原黑屏也盖上）；②现场/远程并行探测（最坏 ~3s），
  全败**立即**弹"重试/切换服务器"+每 4s 自动重探（根治"黑屏很久才出提示"——原因
  是死地址塞给 WebView 等系统超时）；③配置页两地址预填（上次配置回显，无则默认
  现场 192.168.77.54 / 远程 10.66.66.3）。四条流水线全绿（CI/Deploy/Android APK/
  iOS IPA），v1.1.4 APK 已自动入库（a595403），iOS 新构建已传 TestFlight。
- 现场"LED 功放没同开"排查结论：非 bug——分组功能 13:48 才部署，业主测试在前；
  且生产时序器命名（LED大屏功放=2路/投影功放=1路/视频融和器=4路/投影仪=5路）
  已全部命中按名规则，无需改名。业主只需杀掉 App 重开再测。
- 无版权音乐两连交付：①内置 10 首 CC0 背景音乐（1979220，deploy/assets/music/
  随部署自动入库，中文命名三档氛围）；②在线曲库（c20f25c）：媒体页「在线曲库」
  按钮 → FreePD 全库 1016 首 CC0，分类/搜索/GK9000 服务器代下载入库，目录白名单
  +40MB 上限+单下载串行；源 raw.githubusercontent.com，现场不通可配
  FREEPD_MIRROR_PREFIX 换镜像。嵌网易云/QQ 在线播放器已论证不做（版权+接口风险）。
- 空调分区视图交付（07e8be7）：「分区/内机」视图切换，默认分区卡直接组控
  （开关全组/温度步进/五模式），交互对齐灯光页；未分组聚合卡；快选条只在
  内机/编组视图出现；下发走 batch 错峰+乐观更新+复读真机。
- PPT 放映修复+控制补全（37a03a8）：根因=ppt-player.ps1 硬编码 1920×1080 摆窗
  而投影口实际 1280×720（窗口>屏→画面裁边="放大未全屏"）。修：DPI aware+按
  真实显示器边界摆窗；channel 加 docZoom(50-200)；翻页条补 缩放/全屏/退出；
  kiosk PDF 同吃 docZoom。⚠️ 现场需重跑 start-players.ps1 让新守护脚本生效。

## 上次会话纪要（2026-07-28 续）

- 手机版两处 UI 整改交付部署绿（621dcbb）：音响页总览条 2×2（"当前预设"溢出根治）；
  空调页操作浮层预留改为"浮层出现时滚动容器内部预留 248px"（最后一行被压根治）。
  发布流程验证通畅：push → CI + Deploy 一次跑绿，无失败轮。
- 输入源统一交付部署绿（550f86d）：LED/投影两页统一输入源卡片，三按钮指向明确
  （播放内容 / 欢迎页·可编辑称谓=内置动态网页素材 / 欢迎页·默认=本屏静态图）；
  新端点 POST /playback/channels/:slot/welcome；按钮先拉正显示链路（诺瓦回 HDMI1 /
  融合器回 GK9000）；当前源从通道在播媒体名回读；/led/:id/welcome 场景路径梳理为
  三级链（业主指定素材→动态欢迎页→V2460 preset 兜底）。
- 欢迎页编辑器搬到前端交付（5f2a242）：输入源卡「编辑欢迎页」按钮就地改
  主标题/称谓/标语 + 从媒体库选底图模板；PUT /system-branding/welcome 客户端
  token 即可；system_branding_v2 加三列（迁移+自愈双保险）；欢迎页轮询 8s +
  保存时在播则重推，体感立即生效。
- 电源分组开关定稿（4839e51，业主二次修正后重做）：8f82eaf 的 turnOn 后端联动
  已撤销（会让电源页单路开关牵连别路）。终版：分组在页面层——PlayerConsole
  powerNameGroups 按名并入功放路，LED 页开关 = 1f-led +「LED/大屏+功放」路，
  投影页开关 = seq-5 + seq-4 +「投影+功放」路，一个开关多路**同开同关**；
  电源页时序器各路完全独立。⚠️ 功放两路按名定位：业主需在电源页确认名字
  （含 功放+LED/大屏 或 功放+投影），占位名"时序 N 路"不入组。

## 上上次会话纪要（2026-07-27~28）

pm2 僵尸守护根治（146→2，INCIDENTS #9）→ 部署误报根治（#10）→ 文档体系落地
（README 现状头/INCIDENTS/PROGRESS/CLAUDE.md 落 main）→ 业主四项 UI 整改 →
切页卡顿根治（keep-alive 轮询泄漏，#20）→ Android v1.1.3 发布链 → PWA 被踢根治
（令牌签名制 #22，期间 watcher 不跑迁移引发短暂生产崩溃已三重根治）→ CI 必红根治
（#23）→ v6/v6.5 视觉两连 → iOS TestFlight 五关全破。

## 约定

- **每个会话的第一个动作 = 读本文件**。已双保险：`.claude/settings.json` 配了
  SessionStart 钩子（会话启动自动把本文件注入上下文）+ `CLAUDE.md` 顶部硬性指令兜底。
- 会话结束前把状态变化写回本文件（业主一句"把进度写进 MEMORY"即可触发）。
- 部署必须盯到 Actions 全绿才算完；失败自己修，不向业主推送中间失败报告。
- 业主平板/手机改动生效需彻底杀掉 App 重开（换 Service Worker 缓存）。
