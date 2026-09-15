# MEMORY — 会话记忆（新对话从这里接力）

> **用途**：跨对话无缝接力的唯一记忆文件。每次工作会话结束（或状态有变）都更新这里。
> 新对话开场只需说一句："**读 MEMORY.md，继续当前任务**"。
> 长期工程知识（架构/部署坑/铁律）在 `CLAUDE.md`；故障档案在 `docs/INCIDENTS.md`；
> 历史时间线在 `docs/PROGRESS.md`。本文件只放**当前状态与进行中的事**。

## 当前代码上下文（2026-09-15，优先于以下历史快照）

- 当前 Git 基线为 `14515e7`，其 CI 与 GK9000 部署均成功。完整代码导航见 `docs/CODEBASE_CONTEXT_2026-09-15.md`。
- 9 月真实状态已超出下方 7 月记录：多用户资源隔离、个人播放列表、专用播放器凭据、配额与可恢复媒体操作均已上线；不要把下方的“规划中/待迁移”历史描述当作当前事实。
- 运营大屏最近完成 HLS 生命周期泄漏修复（此前会逐轮累积 Hls Worker/MSE，最终白屏）；AI 计数线与 ROI 可在后台编辑并热推；来访照片上墙兼容 iOS PWA。
- 现场可写 JSON（视频绑定/AI ROI、运营 KPI、翻页状态）必须使用仓库外 `DATA_DIR`。工作区中关于运行时数据保护的未提交改动、数据库备份及日志均须原样保留，禁止清理。
- 当前权威现场基线：LED=V2460、3612×1462、HDMI 2.0；视频=6 路子码流 HLS + 3 路独立 AI；生产唯一发布路径=GitHub CI→WireGuard→GK9000。细节分别见 LED、视频、最小部署和运行时数据保护文档。

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

- **灯光两改（832b4b1，07-31 部署绿）**：①全开/全关逐区加 1.5s 错峰延时
  （乐观翻卡随节奏逐个亮/灭，bulkBusy 锁双钮防重入）；②手机竖屏分区卡
  单列→两列（卡内再收紧，7 区 ~4 行），390px 实登截图验证。
- **投影分辨率查证——链路本已最优（a12c748+0231a9d，07-31）**：业主要求
  改分辨率优化画质。新增 set-projector-res.ps1（EDID 内自动选优+备份回滚）
  + 看门狗 projector-resolution.token 杠杆（交互式会话执行+自动重摆窗口）
  + verify 探针带 projector-res.log 尾。**实测重大修正：投影口物理输出是
  3840×2160@29Hz（4K30），到处出现的"1280×720"是 Windows 300% 缩放的逻辑
  坐标假象**——4K 进融合器 ~3400×1200 画布是降采样（画质增益），链路已
  最优，脚本正确判定不动。杠杆保留：以后 token 含 restore 字样=回滚。
  画质再上台阶只剩"素材直推融合器本机播放"（协议已支持，待业主要）。
- **灯光页紧凑化（af5a422，07-31 部署绿）**：分区卡网格固定 4 列改
  auto-fill minmax(215px)（1360→5 列、1920→7-8 列），内距 16→12/14、
  间隙 12→8、亮度大数字 26→20（撑高主因）、预设钮 6px（min-height 32
  兜底）；手机保单列（保滑条全宽），单卡 ~190→165px。Playwright 双视口
  实登截图验证过。
- **手机音响页省两行（02e3661，07-31 部署绿）**：≤600px 静音钮从头部独占
  行挪进状态条右端；总览去掉平均音量/当前预设只留两项一行（桌面/平板
  四卡+头部钮不变）。⚠️ 状态条内钮显示规则须 0,2,0 特异性（基础
  display:none 源码顺序在后）。
- **音响页两改（36e53b7，07-31 部署绿）**：默认 tab scene→bgm；背景音乐
  tab 顶部加「分区接通」开关条——4 个分区喇叭（OUT5-8）胶囊开关控制矩阵
  交叉点 OUTx←IN5（BGM 音源，接线固定），与矩阵页同状态同下发链路；
  LED/投影声道（OUT1-4）不入此条防误接；矩阵离线显提示。
- **三项整改 v1.1.10（ff28b29，07-31，四流水线一把全绿）**：①手机后台侧栏
  行距第三版取中（放宽版超出一屏，行高 ~38px 全菜单 ~780px 一屏装下）；
  ②BGM 播放列表删除钮可见化（原 hover 才显形=平板隐形+小方块图标像停止，
  改常显垃圾桶+移出确认弹窗）；③后台登录页面容登录：壳桥升级双槽位
  （scope client/admin 分开存，v1.1.9 老接口保留兼容），AdminLogin 加面容
  按钮+登录静默同步管理密码，新增 useShellBio 公共助手（ClientLogin 同步
  切换）。Android code18 已自动入库，iOS build7 已传 TestFlight。业主路径：
  更新 App → 后台手动登录一次 → 后台登录页出现面容按钮。
- **面容登录 v1.1.9（d915394，07-31，四流水线一把全绿）**：在 v1.1.8 应用锁
  之上补"真·面容登录"——访问密码存壳安全存储（Android Keystore 加密 prefs
  /iOS Keychain 本机专用），清缓存/令牌过期后登录页出「面容/指纹登录」按钮，
  刷脸→壳注回密码→自动登录。壳桥 window.JinhuShell 四方法（bioInfo/save/
  clear/requestBioLogin，回调 __jinhuBioLoginOk/Fail），无"不验证直接读"口子；
  PWA 每次手动登录成功静默同步密码进壳（改密自动更新）；浏览器无桥不显示。
  Android code17 已自动入库，iOS build6 已传 TestFlight。业主路径：更新 App
  → 手动登录一次（密码进壳）→ 之后登录页就有面容按钮。
- **wav 二连修（68b2bd2，07-31 部署绿）**：业主复报 wav 仍不能播，两个叠加
  根因：①上一版按下载 URL 提扩展名，但媒体 URL 是 /api/media/:id/file 根本
  不带扩展名——提取永远落空回落 .mp3；改为主取 currentMediaName（原始文件名）
  URL 兜底。②bgm-player 是常驻进程，部署只换文件不换进程；已拨
  relaunch-players.token（watchdog 每分钟检查、变更即整组重启播放器）——
  **以后改播放器脚本都用这个令牌远程生效，无需现场**。等业主复测 wav。
- **wav/m4v 全播放链支持（9fb2eb6，07-31 部署绿）**：业主报 wav 播不了。
  根因=bgm-player.ps1 固定下载成 sc-bgm.mp3 喂 MCI，MCI 按扩展名选解码器
  （内置"左右声道测试.wav"从来没能经 BGM 播出）。修：临时文件保留真实扩展
  名；MCI 打不开的格式（裸 Win10 无 flac/ogg 解码）改请求 advance 跳曲不再
  卡死；.m4v mime x-m4v→标准 video/mp4（含存量自愈）；上传链三处视频扩展
  名兜底（Windows 对 .m4v/.mkv 常报 octet-stream 会被 video/* 判断误拒）+
  ingest 时按扩展名纠正 mime。**⚠️ bgm-player.ps1 生效需现场重跑
  start-players.ps1（或重启 GK9000）——还没做，业主下次到现场记得跑**。
- **双端面容/指纹解锁 v1.1.8（5de1859，07-30，四流水线一把全绿）**：应用锁
  形态（令牌本就 30 天自动登录，缺的是拿到手机就能操控的防线）——开着时
  冷启动必验、切后台超 60s 回来重验，全屏锁定层挡住一切；Android
  BiometricPrompt（WEAK|DEVICE_CREDENTIAL）、iOS LocalAuthentication
  （面容→锁屏密码兜底，Info.plist 已补 NSFaceIDUsageDescription）；配置页
  开关**默认关**，开/关都要先过一次验证。Android code16 已自动入库
  （终端会弹更新），iOS build5 已传 TestFlight。业主启用路径：更新 App →
  配置页（登录页右下角齿轮）→「面容 ID/指纹解锁」开关。网页端无此能力。
- **部署链竞态三连修（1bafe79，07-30 深夜，最终双绿）**：d7142f9/e1615c2 两轮
  Deploy 红，复盘=三层竞态非真故障（kiosk 心跳全程活，仅两次 15-30s 后端重启）：
  ①update.ps1 对任何提交无脑全量重建+delete 硬重启+admin-restart 再重启——纯前端/
  脚本/文档提交也停机两遍，且刷新 dist 时间戳让 verify"进程比产物旧"永久误报；
  ②CI 自愈 WMI 重启与 watcher 重启并发打架（守护僵尸 2→22）；③WMI 脱离重启有
  5-30s 延迟，复验健康轮询探到未死老进程→复验撞重启中场→误判崩溃循环。
  修：update.ps1 按 git diff 路径条件化（backend/deploy 无改动→跳过构建/迁移/
  seed/重启全链，生产不停机）；deploy-from-ci 复验两阶段轮询（先等健康掉=重启
  真发生，再等恢复）。⚠️ 经验：手机侧栏 CSS 这种小提交部署红，先看是不是这类
  竞态（verify 报"旧代码"/"崩溃循环"但 kiosk 心跳活=大概率误报），别慌着回滚。
- **手机端后台侧栏行距放宽（d7142f9）**：≤600px 抽屉行高 44px+/行距 6px/
  分组间距拉开/底部按钮让出安全区；桌面平板不动。
- **最终版性能优化（0b6da55，07-30 部署绿）**：全面体检确认既有优化到位
  （路由全懒加载/EP tree-shake/pdf.js 动态导入/winston warn/SQLite WAL/
  PWA NetworkFirst），补两处真空：①后端 compression gzip（threshold 1KB，
  按 content-type 过滤不碰媒体流；实测 /api/devices 出 gzip、小响应跳过）——
  远程慢链路 JSON 立省 70-90%；②媒体页三视图+后台媒体选择器+品牌表缩略图
  loading=lazy（缩略图是原图全文件，全量并发拉取曾挤爆慢链路连接池）。
  后端 225 单测绿。新依赖 compression 已进 lockfile，部署 pnpm install 自装。
- **主题对比度 v7 一步到位（dc6d427，07-30 部署绿）**：业主"再提高深浅色
  对比度+增加层次感"。全在 design-tokens.css token 层动刀：深色底压深
  #06090F+卡片抬亮 #242F44（bg→卡对比 ~3.2）、描边/叠加/高光/文字随面上提、
  阴影四档加重、EP 弹窗浮层实色上移到高于卡片（#2E3B55）；浅色第三轮底灰
  压到 #DFE6F0（白卡对比已到头，再深发脏勿再压）、描边/text-2/3/阴影跟进。
  Playwright 深浅双截图验证过。浅色若业主还嫌弱，下一步只能动结构（分区
  底色块/标题条），token 已到头。
- **全站 logo 蓝底清除（a0b7166，07-30 部署绿）**：业主报后台登录卡 logo 底色
  仍是写死蓝渐变，全站排查同类问题一并修：AdminLogin/ClientLogin 登录卡、
  MainLayout 侧栏品牌磁贴、PlayerPage 大屏待机 200px 磁贴、SystemBrandingAdmin
  标签页 favicon 预览小方块（原纯装饰蓝块，有图显真图）。统一规则=有 logo 图
  → 容器透明+去光晕+contain；蓝渐变只留给无图文字兜底。按钮渐变不属此列未动。
  AdminLayout 走 BrandLogo 组件（此前已修）；BrandsAdmin 设备品牌缩略图本来就是
  中性底 contain，无需动。业主端生效需杀 App 重开（或清缓存按钮）。
- **前台编辑权限统一收权（a761555，07-30）**：盘点出前台 5 处改文字入口
  （BGM 曲目改名/LED投影列表改名/音响输出通道改名/灯光分区改名/编辑欢迎页），
  双击改名交互全部移除（误触源），入口保留但点开先过「管理员验证」弹窗
  （useAdminUnlock 统一实现，登录后台 8h 内免输）；后端 4 个写接口挂
  AdminGuard（playback rename/audio-config zones PUT/light-zones PUT/
  system-branding welcome PUT）前后双保险。admin 后台配置页不受影响。
- **BGM 切歌按钮（8204977）**：播放列表每行加常显 32px 播放按钮（原来
  行内按钮 hover 才显示=平板看不见、曲名区吞单击）。
- **后台令牌签名制（ffb2719）**：admin token 照 client #22 方案改 HMAC 签名
  +tokenSecret 持久化（迁移 1785180000000+自愈），部署重启不再踢后台；
  同时删后台欢迎页编辑区、预览 logo 有图时透明底+contain（原写死蓝渐变）。

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
