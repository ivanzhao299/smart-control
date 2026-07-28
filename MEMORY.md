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
5. 真电表 DDS866 接入（power adapter 仍 Mock，框架已备）。
6. 1F DALI 网关 L2 Modbus 超时（待现场硬件排查）。
7. 电源时序器接入情景模式场景引擎（业主未要求，暂缓）。

## 最近一次会话纪要（2026-07-27~28）

pm2 僵尸守护根治（146→2，INCIDENTS #9）→ 部署误报根治（#10）→ 文档体系落地
（README 现状头/INCIDENTS/PROGRESS/CLAUDE.md 落 main）→ 业主四项 UI 整改 →
切页卡顿根治（keep-alive 轮询泄漏，#20）→ Android v1.1.3 发布链 → PWA 被踢根治
（令牌签名制 #22，期间 watcher 不跑迁移引发短暂生产崩溃已三重根治）→ CI 必红根治
（#23）→ v6/v6.5 视觉两连 → iOS TestFlight 五关全破。

## 约定

- 会话结束前把状态变化写回本文件（业主一句"把进度写进 MEMORY"即可触发）。
- 部署必须盯到 Actions 全绿才算完；失败自己修，不向业主推送中间失败报告。
- 业主平板/手机改动生效需彻底杀掉 App 重开（换 Service Worker 缓存）。
