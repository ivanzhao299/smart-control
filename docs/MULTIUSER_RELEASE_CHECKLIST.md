# 多用户交付收敛清单

## 用户要求

不同用户管理自己的上传资料、播放列表及历史；管理员查看管理全部内容；保留向共享大屏、投影和背景音乐推送的能力；保留改造前版本标记及可验证恢复路径。不能用测试数量替代上线交付。

## 当前证据与真正的发布缺口

2026-09-08更新：使用独立候选/Users/mac/.codex/worktrees/smart-control-multiuser-release（codex/multiuser-release-integration），保留原工作区合并中改动。当前origin/main及生产磁盘代码已为b98ddc5，包含新园区大屏；下表的旧基线/旧接线描述为历史，发布前必须以此更新重新核验。暂停、凭据发放、迁移及恢复任务入口已有候选并经过隔离测试，但真实停写和生产迁移仍未执行。

| 要求 | 当前证据 | 尚需完成 |
| --- | --- | --- |
| 资料归属与跨用户访问隔离 | MediaService SQLite测试及四角色真实浏览器上传、读取、越权拒绝测试 | 发布后用真实账户验收 |
| 管理员全量查看与管理 | 浏览器管理员内容入口、用户管理/资料归属及权限测试 | 生产管理员实际工作流 |
| 个人列表和历史 | personal-playlist及playback-isolation测试，包含发起人归属和历史过滤 | 生产账户切换确认 |
| 向共享设备推送 | PlaybackService模拟硬件的发布/会话/权限测试，播放器设备接口已实现 | GK9000实际设备凭据配置、LED/投影/BGM各一次推送验证 |
| 可恢复发布 | pre-multiuser-20260905指向8d4ce521；配套备份和隔离恢复工具测试 | 真实停写与备份控制接入，现场恢复证据 |
| 上线版本一致 | 本地功能分支存在；origin/main仍为改造前版本 | 推送、CI、合并、部署，确认运行SHA及健康响应 |

## 不再扩大本次上线前提

停止新增配额能力、通用崩溃恢复平台、更多转码增强等扩展工作。已有改动保留，不用未经分析的回退破坏迁移链；对半接入功能逐项决定随核心版本保留或在独立后续版本交付。必要的越权防护、现有设备兼容和备份不能省略。

## 下一步必须处理的具体事项

1. 生产运维连接已于2026-09-07实测恢复确认：显式使用历史跳板维护身份登录阿里云，再使用跳板上GK9000专用身份连接user@10.66.66.3，返回hostname=GK9000。D:/smart-control的Git HEAD为8d4ce521de50c6d2250027990760dd3933e38a00；这仅证明磁盘代码，不等于运行进程版本。局域网3200端口client-auth/ping返回有效在线JSON，5173前端返回200。默认SSH失败不能代表此双跳路线失败；不得用会自动修复/重启的verify入口冒充只读检查。
2. 配置并验证PLAYER_DEVICE_CREDENTIALS、浏览器kiosk凭据及SMART_CONTROL_PLAYER_TOKEN_FILE。start-players.ps1目前并不自动配置它们，漏配会使既有播放器无法使用；这是实际兼容问题，不是可选增强。
3. 串联定向暂停、配套备份、迁移、启动流程。已新增suspend-gk9000-release.ps1、assert-gk9000-writers-stopped.ps1和run-gk9000-migrations.cjs，并有只读及隔离测试；仍缺代码部署时序、任务原状态恢复和受控启动接线，真实暂停/迁移尚未执行。普通run-migrations CLI有待执行迁移时仍拒绝；不能声称现有CI可直接完成发布，也不能只删除保护检查来放行。
4. 用两名普通用户及管理员执行上传、互不可见、本人推送、管理员管理、账户切换验收，确认LED/投影/BGM仍工作，再完成版本证明。

## 暂存改动

2026-09-07双跳只读查询确认计划任务SmartControl-AutoUpdate、SmartControl-DailyBackup、SmartControl-PlayerWatchdog、SmartControlBackend的State=3（Ready），SmartControlFrontend为State=1（Disabled）。Ready不证明进程已停止或正在运行；发布停写控制必须进一步核验这些任务的触发器及实际进程。start-players.ps1明确禁止在SSH会话直接启动播放器，应通过物理控制台交互任务执行，避免将正常屏幕替换为Session 0不可见窗口。本次未执行任何任务、重启、备份或迁移。

ppt-player预留接线代码尚无Windows/COM实测。document-conversion-flow测试原失败是fixture缺少playback_channels.name/outputKind，已补齐并实测三条服务流程通过；这不等于PowerShell或现场验收通过。
