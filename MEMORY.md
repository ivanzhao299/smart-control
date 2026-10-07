# MEMORY — 会话记忆（新对话从这里接力）

> **用途**：跨对话无缝接力的唯一记忆文件。
> **强制：每次会话只要有任何更新就必须当次回写本文件（不得积压到会话结束）；每个新对话第一个动作必须先读本文件。**
> 新对话开场只需说一句："**读 MEMORY.md，继续当前任务**"。
> 长期工程知识（架构/部署坑/铁律）在 `CLAUDE.md`；故障档案在 `docs/INCIDENTS.md`；
> 历史时间线在 `docs/PROGRESS.md`。本文件只放**当前状态与进行中的事**。

## 当前代码上下文（2026-10-07，最新，优先于以下所有历史快照）

> **强制铁律（业主 2026-10-07 死命令）**：① 每次工作会话只要有任何更新（代码/状态/结论/部署），**必须当次回写本 MEMORY.md，不得积压、不得等会话结束才补**；② 每次新建/进入对话，**第一个动作必须读本 MEMORY.md**；③ 工作在 smart-control（SmartCtrl）时**严禁跨项目查询**（不得到其他项目目录搜文件），一切以本项目 git log 与项目内文件为权威。

### 当前基点
- 权威开发目录 `/Users/mac/Documents/smart-control-4g-dev`（**禁碰 `/Users/mac/Documents/smart-control`**）；当前分支 `feat/energy-management`。
- 仓库 `ivanzhao299/smart-control`；**最新三端一致、已部署生产 = `831b188`**（2026-10-07）；origin/main = 831b188。
- 生产 GK9000（Win10，`D:\smart-control`，内网 192.168.77.54，WG 10.66.66.3），pm2 守护 backend(3200)+frontend(5173)；入口 https://erp.cnjinhu.top ，账号 admin/jinhu888。
- 部署走 GitHub Actions `deploy-gk9000.yml`（跳板 123.57.220.65 → WireGuard → deploy-from-ci.ps1），**不用 GK9000 执行器**；流程铁律：本地验收→业主同意→才部署，三端同 commit、CI 绿且生产真生效（进程重启+新dist+回验+verify）。

### 2026-10-01～10-07 已交付并部署（详见 git log）
1. **华普云 4G 云断路器接入**（`4b6b7bf`）：3 台云开关——庭院亮化 CB28100573(fId `21055272433774694401`)、鱼池供氧 CB28100574(fId `2105527756560371714`)、园区路灯 CB28100572(fId `210552830251905025`)；华普云 API base `https://www.hperfor.com/homeschool`，账号 15963930001/along888；新增 EpaHperforApi 适配器，485 适配器不动。
2. **日落定时调度**：以日落为参考时点，开/关均可前后偏移 **−600..+600 分钟（±10 小时）**形成时间段；每天推精确时刻、不做每分钟轮询。
3. **能源管理 / 园区能源中心**（`2ab5e85` 等）：接华普云 `device-total` 累计电量、自动同步（无手动按钮）；多维模型 **变压器 10 台、楼栋 30 栋（名称均可编辑）+ 电梯能耗**；光伏（锦浪云 1.6MWp，模块 `backend/src/modules/pv/`）迁入能源页；运营大屏新增"能源管理"页；后台 EnergyAdmin 只留台账配置（KPI/趋势/占比归前台）。
4. **运营大屏能源页可见性修复（本地已改、未提交未部署）**：`backend/src/modules/cameras/park-ops-control.service.ts` 硬编码 `TOTAL_PAGES=6`（实际 `frontend/public/park-ops/index.html` 有 7 个 `section.page`、能源页 idx=6），已改 7，DTO `@Max(5)`→`@Max(6)`，同步 spec（5 项过）、nest build 过、本地实测翻到第7页/回绕/越界拒绝均正确。**待业主同意后提交部署。**
5. **页面切换性能**（`c7c9518`/`98b2079`/`5ed1e46`/`075c3c9`）：时序器/投影/空调/音响/电源读数改后台预采集快照、WS 推送；http GET in-flight 合并 + 短 TTL；named-admin 身份检查缓存。仅动体验、不碰功能代码。
6. **权限**：admin/operator/viewer 三角色；操作员可编辑欢迎页（`2ab5e85`）；后台登录默认落地运维监控、设备管理显示云平台运维信息（`9d7927d`）。
7. **播放器 provision**：headed Edge 交互式 profile provision 工具（`5171b4b`）；Watchdog / DailyBackup 已恢复。
8. **安全修复**：brace-expansion@2.1.6、source-map-js@1.2.2（DoS）。
9. **公网慢根因 + 方案 A 已落地（2026-10-07）**：erp.cnjinhu.top 解析到阿里云**新加坡 47.236.122.224**、绕海外回国（实测约 2.05s）。**国内直连 `https://erp.cnjinhu.com`（cnjinhu.com 已备案子域）已上线**：DNS A→123.57.220.65、certbot 证书 `/etc/letsencrypt/live/erp.cnjinhu.com/`（自动续期）、nginx 配置 `/etc/nginx/conf.d/erp.cnjinhu.com.conf`（复用 scLogin 限流 + 反代 10.66.66.3，未重复定义 zone）。实测 **0.147s、比 .top 快约 14 倍**，浏览器登录页正常渲染。旧 .top 保留备用。**2026-10-07 进一步把权威地址在部署文件/移动端统一改为 .com（commit `1e17787`，命中 paths-ignore 不部署盒上代码）**：`tools/ci/verify-production-remote-address.mjs` expectedRemoteUrl、iOS `Prefs.swift` defaultRemoteUrl、Android `build.gradle.kts` DEFAULT_REMOTE_URL、deploy-gk9000.yml 的 3d-twin 冒烟基址；iOS/Android 壳里 `.top` 主机常量**保留**（用于把旧 .top:8443 自动迁移到新默认）。iOS IPA / Android APK（已发布展厅）/ CI 均重新构建成功。**部署链路（deploy-gk9000.yml）本就 SSH 到国内跳板 123.57.220.65→WG→GK9000、从不经过新加坡。** **随后发现覆盖安装保留标准 .top:443 的缺口（旧收敛只管 .top:8443），已由 `a238e68` 补全：iOS/Android 对任何保存的 erp.cnjinhu.top（任意端口/无端口）首次读取即改写到 .com；新 APK 经 `831b188` 发布、deploy run 37613692899 成功、生产三端一致。**

### 未闭环 / 待办
- **【已恢复·2026-10-07 16:52】LED 切播放源/欢迎页上不了屏**：根因不是切源代码被改坏（10-06 后 5 个提交成功链路均未动），而是**运行时 GPU/合成进程卡死**：kiosk slot1 用 iframe 加载运营大屏（id=81，与 PlayerPage 主文档共享同一 Edge GPU/合成进程），大屏这两天新增重内容（能源页等），运行中 GPU/合成被卡死、画面定格，而页面 JS 心跳照常上报→只看心跳的看门狗误判健康（**假健康**）。经 player-watchdog 内置 git 杠杆 `scripts/relaunch-players.token`（仅写文件、watchdog 下一 tick 在物理 console 会话跑 start-players 重启，SSH 会话不建窗口）重启 kiosk 后恢复，业主确认切源/欢迎页正常。
- **【根治三件套·已本地验收、未提交未部署】**（2026-10-07）：
  ① **Web Worker 软看门狗** `frontend/src/composables/useRenderWatchdog.ts`：主线程 rAF 报帧、Worker 独立线程计时，连续 ~12s 无帧且再确认一周期则发 reload 信号、**主线程** `window.location.reload()`（⚠️ Worker 的 self.location 是 WorkerLocation、**没有 reload()**、Worker 无法自行导航）；文档隐藏挂起、可见恢复。浏览器实测：正常 fps=119 不误触发；rAF 冻结（模拟合成卡死、事件循环活）后 ~20s 自动重载成功（timeOrigin 更新、stallCount=1）。
  ② **运营大屏降载** `frontend/public/park-ops/js/app.js` go() 切页：oldPage video pause（停后台解码）、newPage 已初始化 HLS video 恢复（实例保留、不重拉流）；3D 地图（非活动/隐藏暂停）、ambient canvas（hidden）、3d-twin（IntersectionObserver 按需）本就有暂停机制；能源页图表全是 DOM/CSS 柱、无 WebGL/canvas。
  ③ **PlayerWatchdog 假健康兜底**：kiosk 心跳 body 携带 `{fps,stalls,healthy}` → PlaybackService 内存 Map（不落库）→ state 返回 `renderHealth`；`player-watchdog.ps1` 新增 3a 段（纯 ASCII）：心跳新鲜但 renderHealth 持续不健康满 90s（软看门狗 reload 后仍未恢复）才 forceRelaunch，标记文件用清空代替删除。curl 实测健康/不健康心跳存取与 state 返回正确、错误 token 401。
  配套：欢迎页绑定素材自动 markShared（SystemBrandingService.update 后对 welcome 图批量共享，解决 119/122 private 操作员看不到；生产 119/122 已手动改 shared）；http.ts 把 `/playback/channels`、`/system-branding` 移出 GET 短 TTL 缓存。
  **已提交并部署生产 = `50b63d3`（含 f63b4b3 功能；spec-only 提交命中 paths-ignore，故用 workflow_dispatch 手动触发），三端一致、CI 绿、生产后端重启/dist 更新/页面回验通过。**
- 权威地址已统一为 erp.cnjinhu.com（见上 9，含部署文件/移动端/App 自动迁移，831b188）。**彻底解绑新加坡 47.236.122.224 尚未做**：原生 App 已自动切 .com；仍需确认 erp.cnjinhu.top（浏览器/PWA 手动访问）无流量后，再停用 .top 解析与新加坡机（资源下线，须先请示）。
- **普通用户权限收窄**：业主拟仅开放 ①文件上传 ②系统管理里下载更新文件，**仅策划、未实现**，动工前再对清。
- PWA 输错密码无提示：本地干净复现/结论未取。
- 变压器/楼栋正式名称、容量、面积待后台录入；本地 main 分叉 d9d47ed(PR#118) 是否上线待定；易微联等开发者认证中。

## 当前代码上下文（2026-09-20，TestFlight「一键续期」已上线并配好 PAT，优先于以下历史快照）

### 2026-09-20 下午：内部测试员「两步法」+ App Manager 钥权限实测（许万玺入职）
- **内部测试员是两步，后台目前只自动化了第①步**：① `POST /v1/userInvitations`（MARKETING 团队邀请）→ 受邀人在邮件里接受后成为 `/v1/users` 团队成员（原 userInvitation 资源**同 id** 转成 users，pending 邀请即消失）；② **还要把该团队成员加进内部 TestFlight 组**，他才会收到 TestFlight 可测通知并能装 build（ASC 网页：App→TestFlight→内部测试组「内部测试」→ Add Testers 勾选该成员；行状态 Invited→装完变 Installed）。后端代码**没有任何 betaGroups 关系写调用**，第②步暂未自动化：API 试 `POST /v1/betaGroups/{内部组id}/relationships/betaTesters`（body 用 users 资源 id）返回 **404** 未走通；`GET /v1/betaTesters?filter[email]=...` 对内部成员返回空（内部人没有独立 betaTester 资源）。**以后新内部测试员接受邀请后，都要在 ASC 网页手动 Add Testers 一次**，直到找到可用 API。
- **App Manager 钥 `DJ3328P729` 权限实测**（2026-09-20，生产 .env 配置与本机 p8 公钥指纹一致、GET apps/users 均 200，钥本身有效）：GET apps/users/userInvitations/betaGroups=200；POST userInvitations=**可**（重复邮箱 409）；**DELETE `/v1/userInvitations/{真实 pending 邀请 id}` = 403 FORBIDDEN_ERROR（App Manager 无权撤销团队邀请，需 Admin/Account Holder）**；`GET /v1/apps/{id}/betaTesters`=403；注意 DELETE 一个**不存在**的 id 返回 404（不能用假 id 探测 DELETE 权限）。
- **后台「重发邀请」按钮对 App Manager 钥必然失败 → 已按方案 B 修复（2026-09-20，业主拍板保持最小权限，绝不上 Admin 钥到服务器）**：旧 resend=先 DELETE 旧邀请再 POST，DELETE 403 被 `mapApple` 笼统翻译成「密钥无效或权限不足」（钥其实有效，是 App Manager 角色不能删团队邀请）。修复后 `testflight.service.ts` 的 `resend()` 分三种结果：①已接受→400 无需重发；②仍有 pending 邀请且 DELETE 返回 403→**不报错、不标 FAILED**，记录恢复 PENDING，返回 `state='pending'` + `notice`（引导：原邀请接受前长期有效，让对方在原邮件/垃圾邮件里接受；邮件丢失则由 Account Holder/管理员在 ASC「用户和访问」撤销后重加）；③查无 pending 或 DELETE 404（旧邀请已失效）→直接 POST 新邀请（App Manager 有权限），真正完成重发。`mapApple(err, operation)` 拆分 **401→UnauthorizedException「密钥无效/过期/被撤销」** 与 **403→ForbiddenException「权限不足，无权执行{操作}…」**，409 改用 ConflictException；controller 按 state 出 message；前端 `TestFlightAdmin.vue` 对 pending+notice 弹黄色 warning（10s）、错误展示后端精确 message；表单底部旧「72 小时有效」提示改为「团队邀请接受前长期有效、内部测试无兑换码、丢信走 ASC 处理」。新增 `testflight-resend.spec.ts` 8 例全绿；顺带把 `websocket/frontend-release.spec.ts` 的 fs.watch 等待窗从 1s 放宽到 3s（全量并行高负载下的时序假阳性，与本次逻辑无关）。rebase 到 PR #114（c88996c，含迁移 `1789720000000-AddWelcomeLogo`，其部署 run 35494533988 已成功走持锁迁移流程）之上后本地后端 95 套件/780 测试、前端 97 测试、前后端 build 全绿。**已部署生产：commit `bd31172`，deploy run 35495206778 success（scope=full 前后端、无迁移、2m29s）；生产 HEAD/dist 均 bd31172、PM2 双在线、health 200（12 在线/26 离线）、后端产物含 PENDING_INVITATION_NOTICE 标记、当日日志仅有离线摄像头 HLS 404 常规噪音。**
- **许万玺（662119@163.com）处理结果**：2026-09-20 下午他**已接受团队邀请**（成为 MARKETING 团队成员、仅可见金湖智控）；我已在 ASC 网页把他**手动加入内部测试组**，组内现 **4 人**、其状态 **Invited**（UI 提示 "1 tester has been added"）。内部测试**没有邀请码/兑换码**（那是外部测试 join 链接才有），他在 iPhone 用 662119@163.com 这个 Apple ID 登录、装 TestFlight，收到 TestFlight 通知邮件点「View in TestFlight/开始测试」深链即可装 build #40。
- `/v1/betaGroups/{id}/betaTesters` 端点**偶发连续 404**（同钥同 URL 时而 200 时而 404，重试不复），读不到时以 ASC 网页为准；后端 sync 对该端点 404 应降级而不是判失败。

- **新功能：TestFlight 90 天到期倒计时 + 后台一键续期**（commit **`2425a03`**，无迁移、无新依赖）。后台「系统管理→iOS 测试」新增「构建有效期（90 天）」卡：展示当前 build/上传时间/到期时间 + 彩色倒计时（>30 天绿、≤30 黄、≤14 天或过期红），按钮「一键续期（上传新构建）」，el-steps 四步进度（等待 runner / 归档构建 / 签名上传 / ASC 处理）+ Actions run 链接，4s 轮询、重开页面自动接续在跑任务。
  - 后端：`apple-app-store.client.ts` 的 `getLatestBuild()` 增返 `expired/expirationDate/uploadedDate/processingState/minOsVersion`；**新建 `github-actions.client.ts`**（全局 fetch 零依赖，Bearer PAT，头 `Accept: application/vnd.github+json` + `X-GitHub-Api-Version: 2022-11-28`，超时 20s）；`testflight.service.ts` 加续期**内存态**状态机（dispatch 同步执行、权限错立即抛 HTTP；随后后台 `pollRenewal`：定位本次 workflow_dispatch run≤3min→等 CI≤30min（按 job 名匹配 testflight/upload/sign/archive 区分 building/uploading）→CI success 后等 ASC 出现 build 号更大且 VALID 的新构建≤20min→succeeded，否则 failed；单任务互斥 409）。**状态只在内存，后端重启回 idle**。controller 增 `GET /api/testflight/renewal`、`POST /api/testflight/renew`（整类 AdminGuard）；配置 `testflight.github`，env `TESTFLIGHT_RENEW_TOKEN`（回退 `GITHUB_PAT`），`TESTFLIGHT_RENEW_REPO` 默认 `ivanzhao299/smart-control`、`WORKFLOW=ios-build.yml`、`REF=main`。新单测 `testflight-renew.spec.ts`（5 例，纯函数 summarizeBuild）。前端 `TestFlightAdmin.vue` + `testflight.service.ts`（renewal()/renew()，类型 TestFlightBuild/Renewal/Stage）。
  - 续期本质：TestFlight 每个 build 硬有效期 90 天、ASC 无延长接口；续期=重新打包上传，build 号取 `GITHUB_RUN_NUMBER` 自动 +1；内部测试员对新 build 免审核、内部组自动指向最新 VALID build、**无需重新邀请**。当前 build **#40 / id `d51be7ef-de93-4a7a-9d96-ea3e6e8ede80` / VALID / uploaded `2026-09-09T22:37:19-07:00` / expiration `2026-12-08T21:37:19-08:00`（约北京 12/9 中午到期）**。ASC builds 实测字段：`version,processingState,uploadedDate,expired(bool),expirationDate,minOsVersion,usesNonExemptEncryption`；`isInternalBuild` 不是 build 合法字段（在 buildBetaDetail）；营销版本要带 `fields[preReleaseVersions]=version`。
- **GitHub PAT 已生成并部署**：fine-grained，名 `smart-control-testflight-renew`（id 19878964），owner ivanzhao299、**仅 smart-control 单仓库**、Repository permissions **Actions=Read and write**（Metadata 只读自动必带）、Account 权限无、**有效期 90 天到 2026-12-19**。值只写入 GK9000 `D:\smart-control\backend\.env` 的 `TESTFLIGHT_RENEW_TOKEN=`（改前备份 `backend\.env.bak-renew-20260920123955`），`pm2 restart smart-control-backend --update-env` + `pm2 save`；只读验证 `GET /repos/.../actions/workflows/ios-build.yml` 返回 **200**。令牌不入 git、未回显，服务器与本机临时令牌文件均已删。**红线已守：本轮没有真触发 workflow_dispatch**（#40 12 月才到期，真传会推新 build 打扰测试员 + 花 macOS runner 费）；到期前不要点续期按钮。
- **main 隔夜被一批 codex PR 推进 + 本次 rebase**：推送前 origin/main 已合并 codex PR #105–#111（自托管 MQTT 断路器、UI 主题精简、欢迎页品牌化、按需设备健康检查等）到 **`362cd7c`**（这些合并 CI 均 success）。功能分支从旧点 rebase 到其上（无冲突）→ 新 SHA **`2425a03`**。rebase 后本地首次构建报 `Cannot find module 'mqtt'` 等 6 个 TS 错 + 3 套件 failed-to-run，**根因是 worktree 的 node_modules 陈旧没重装**（mqtt 5.16.0 本就在新 package.json/lock），前后端各跑一次 `pnpm install --frozen-lockfile` 后全绿；main 本身没坏。重装后本地 **92 套件 / 761 测试全绿、nest build 绿、前端 typecheck/build 绿**；CI run **35488017617**（head 2425a03）前后端 success。
- **⚠️ 生产自动部署事实（与业主「最小部署」要求有张力，待业主拍板，未擅改）**：`.github/workflows/deploy-gk9000.yml`（名 "Deploy GK9000 through WireGuard"，concurrency group `smart-control-gk9000-production`、cancel-in-progress=false）在 **每次 push main** 后自动部署到 GK9000（jobs：Validate release(ubuntu) + Deploy to GK9000 经 WireGuard/SSH），带 `paths-ignore`：`.github/**`、`docs/**`、`*.md`、`android-app/**`、`backend/**/*.spec.ts`、`frontend/tests/**`、`tools/ci/**`（所以纯文档/测试 push 不触发部署）；也可 workflow_dispatch。另有 `check-gk9000-status.yml`。隔夜 codex 改动即由此自动上线。本次 2425a03 也是 push 后自动部署（deploy run **35488017667 success**），**GK9000 HEAD=2425a03**、前端 dist `deployment-version.json` commit=2425a03、pm2 两进程 online（backend pid 5204、frontend pid 21108，frontend v5.4.21）、health ok（12 设备在线）、前端 5173 登录页 200、`GET /api/testflight/renewal` 未授权 401（路由存在）。部署期间 5173 曾短暂不可达=换 dist 停 vite preview 的正常瞬态。**是否把该自动部署改为手动批准/环境门禁/按路径触发，需业主决定**。
- 备用最小部署分支 **`release/tf-renew-minimal`（尖 `cd4243a` = 生产旧点 a8e01a6 + cherry-pick 续期功能，本地+origin 均有，本地构建验证通过）最终未使用**（因服务器实际已被自动部署带到 main，直接随自动部署增量即可）；保留或删除待业主定。
- 待办/业主决策：①自动部署门禁是否改最小化（见上，**仍未定**）；②外部测试员/公开链接以后再做。
- **2026-09-20 收尾清理（已完成）**：①备用分支 `release/tf-renew-minimal` 本地+远端均已删除；②旧 ASC API 钥 **`8K53TVACBJ`（名称 CI、App Manager、最后使用 Jul 28）已在 ASC 撤销**，现 Active 仅 3 把：`4KZPX4U9TT`(Admin, AirconController CI Chrome)、`DJ3328P729`(App Manager, Backend TestFlight，生产后台在用)、`LYT3HGHY4G`(Admin, CI-admin，CI 云签名在用)；Revoked 列表 3 把（含本次 CI/8K53 与历史 AirconController CI/CI2）。撤销旧钥不影响 CI（CI 用 Admin 钥 LYT3HGHY4G）与后台（DJ3328P729）。

## 当前代码上下文（2026-09-19 深夜，GitHub Actions 计费已恢复、CI 转绿，优先于以下历史快照）

- **GitHub Actions 已恢复可用**。停摆根因不是 Billing 失效而是**个人账户 Actions 月度预算用满**：`github.com/settings/billing/budgets` 里 Actions account budget 显示 `$50 spent / $50 budget`、100%、Stop usage=Yes，达顶后所有 workflow 在零步骤被拦（run 注解原文 "The job was not started because recent account payments have failed or your spending limit needs to be increased"，与支付失败同文案，易误判）。业主已把 Actions 预算从 **$50 提到 $100**（保留「达顶停用」硬顶 + 75/90/100% 告警）。验证：重跑旧 run 两 job 立即 in_progress；修复后新 run **35438371225（head 9d6ea51）前后端全绿**。Codespaces/Packages/LFS/AI 预算均 $0 未动。查账接口 `/users/{u}/settings/billing/actions` 需 token 带 `user` scope（默认 gh token 404），直接看 Budgets 页更快。
- **顺带修复一个被计费掩盖的 main 测试回归**（commit **`9d6ea51`**，仅改 2 个 *.spec.ts，**无运行时改动、不需要部署生产**）：迁移 #41 `CreateTestFlightInvitations1789700000000` 排在最后一个只进不退目录迁移 `EstablishBundledMediaAuthority1789680000000` 之后，破坏 `src/modules/media/migration-chain.spec.ts` 的回滚栅栏顺序（首个 `undoLastMigration` 期望抛 BUNDLED_MEDIA_AUTHORITY_ROLLBACK_REQUIRES_ARCHIVE，却先回滚了 TestFlight 普通表而 resolve）。修法：①首个栅栏断言前先回滚所有 `timestamp>1789680000000` 的普通迁移（当前仅 TestFlight 表），最终 `multiuserAndLater` 批量回环加上界 `<=1789680000000` 避免重复计数；②给该全链测试 `beforeAll` 建独立空 `DATA_DIR`(mkdtemp)，杜绝同 worker 其它用例泄漏的 DATA_DIR/损坏 park-ops JSON 污染全链（CI 曾因此报 `PARK_OPS_METRICS_IMPORT_FAILED ... JSON position 1`，本地单跑不复现、属顺序相关）；③`park-ops-metrics-migration.spec.ts` 的 afterEach 改 try/catch destroy + 必还原 env/必删临时目录。本地全量 **88 套件 / 739 测试全绿、nest build 绿**。
- 当前 **origin/main = feat/testflight-tester-admin = `9d6ea51`**；生产 GK9000 仍部署在 `a8e01a6`（`9d6ea51` 纯测试、`be37cdf` 纯文档，均无需下发，符合最小部署）。TestFlight 续期「一键」的 CI 前置已扫清；真做后台按钮仍需在后端 env 配一把带 `repo`+`workflow` 权限的 GitHub PAT，用于触发 `.github/workflows/ios-build.yml` 的 `workflow_dispatch`（testflight job：macos-26 云签名归档上传，build 号取 GITHUB_RUN_NUMBER；workflow_dispatch 在 main 上会同时跑签名上传，会真的传新构建，验证 runner 时别误触发，用 CI 的 Linux run 验证即可）。

## 当前代码上下文（2026-09-19 晚，TestFlight 内部测试员 ASC 对账同步已上线，优先于以下历史快照）

- 生产/远端 `main` 与分支 `feat/testflight-tester-admin` 同点 **`a8e01a692397febef2674df9199f18e3ac734fb1`**；GK9000 `D:\smart-control` 已用**无迁移最小部署**到该提交（上一生产点 `2640905`，中间仅多本次 5 个源文件 + MEMORY.md）。后端 3200（pid 5252，↺1）、前端 5173（pid 18768）PM2 在线、健康 200；**迁移总数仍 41，本次无迁移、未走持锁三步、未碰播放器**。
- **新功能：ASC→本地单向对账同步**。后台「系统管理→iOS 测试」进页面自动与 App Store Connect 对账一次（60s 节流），另有手动按钮「与 App Store Connect 同步」（force 绕节流）。新增路由 `POST /api/testflight/sync`（AdminGuard，HttpCode 200）；`GET /api/testflight/testers` 内部先 `syncFromApple(false)` 再返回，苹果失败降级本地台账。苹果客户端新增只读枚举 `listInternalBetaTesters(internalGroupId)`（`GET /v1/betaGroups/{id}/betaTesters`，**已接受权威来源**）、`listTeamUsers()`（`/v1/users`，补角色）、`listPendingInvitations()`（`/v1/userInvitations`）。
  - **死路勿再用**：`GET /v1/apps/{appId}/betaTesters?filter[inviteType]=INTERNAL` 对 App Manager 钥返回 **403 GET_RELATED only DELETE**。内部组成员的 `inviteType` 实测是 `EMAIL` 不是 `INTERNAL`，不能按它过滤。
  - 对账口径：已接受=内部组 betaTesters（照实镜像，含管理员等团队成员）；待接受=userInvitations 中**含 MARKETING 且不含 ACCOUNT_HOLDER/ADMIN/APP_MANAGER**；按 email upsert，新导入行 `invited_by='apple-sync'`、`invitedAt` 留空；**不删本地、不反向改苹果**；苹果侧查不到的本地行保留（过期由 effectiveStatus 推导，FAILED 保留）。`role` 列 varchar(32) 装不下多角色，用 `primaryRole()` 按 ROLE_RANK 存单一主要角色（无迁移）。
  - 实测对账结果（2026-09-19）：本地 4 行=已接受 3（宋乾昌 805331163/ADMIN、zhaoyongwei 344066039/ACCOUNT_HOLDER、黑眼臭臭 940300755/MARKETING）+ 待接受 1（许万玺 662119@163.com，MARKETING，有效期 2026-09-22 15:05 CST，可重发）。UI 总览 总数4/待接受1/已接受3/失败0。
- **无迁移最小部署实操（本次验证可行，作为以后样式/代码小改标准）**：服务器 `git fetch` + `git merge --ff-only origin/main`（生产 main 跟踪区干净时只落增量文件，未跟踪的 `.env.bak-*` 不挡）。后端改→`backend` 下 `pnpm run build`（nest）后仅 `pm2 restart smart-control-backend --update-env`；前端改→见下条换发后仅重启 frontend；都 `pm2 save`。无 lock 变化不跑 install、不跑迁移、不碰播放器/计划任务。
  - **前端 Windows 文件锁坑（重要）**：vite preview 运行中直接 `vite build` 会在 `dist\deployment-version.json` 上 **EPERM**（emptyOutDir/写文件均失败，重试也不行）。可靠做法=**前端不停机先 `pnpm exec vite build --outDir dist-deploy --emptyOutDir`，再 `pm2 stop smart-control-frontend`，把 `dist` 改名 `dist.bak-<ts>`、`dist-deploy` 改名 `dist`，`pm2 restart smart-control-frontend`，pm2 save**，停机仅数秒；验证 200 后删 dist.bak。前端构建 GK9000 需 `$env:NODE_OPTIONS='--max-old-space-size=4096'`。现场另有原生存放目录 `frontend\dist-live`（非本次产物，勿删）。
  - 运维事实：GK9000 实时应用日志是 `D:\smart-control\logs\app-YYYY-MM-DD.log`（JSON）与 `error-*.log`，不是 `C:\Users\user\.pm2\logs\*.log`（那两个停在历史日期）；慢请求由 context=`Latency` 以 warn 记录（testflight 枚举约 1–2s 属正常 SLOW，非错误）。PowerShell 5.1 非交互 ssh 的表格/中文输出会被本地管道吞，复杂逻辑写 .ps1（UTF-8）scp 后 `powershell -NoProfile -ExecutionPolicy Bypass -File` 执行，输出尽量纯 ASCII/Write-Host。
- 本轮临时脚本与只读探针已从服务器 `C:\Users\user\` 全部删除（probe-enum.cjs、tf-dbcheck.cjs、tf-logs.ps1、gk-*-deploy*.ps1、tf-cleanup/verify.ps1）；备份与恢复包、`backend\.env.bak-tf-20260919163639` 全部保留。

## 当前代码上下文（2026-09-19，iOS TestFlight 内部测试员邀请后台已上线，优先于以下历史快照）

- 生产/远端 `main` 与分支 `feat/testflight-tester-admin` 同点 `2640905e52c7ed11a678c3a2a3423a72fa3b64fb`；GK9000 `D:\smart-control` 已用持锁发布到该提交。后端 3200/前端 5173 由 PM2 唯一进程持有（激活后重启 0、无孤儿），迁移总数 **41**（新增 `CreateTestFlightInvitations1789700000000`，表 `testflight_invitation_v1`，email 唯一索引 `IDX_testflight_invitation_email`，integrity ok/FK 0）；根目录无 `RELEASE_HOLD`（归档 `logs\activated-hold-*`）；PlayerWatchdog/DailyBackup/Backend 计划任务 Ready 且播放器已拉回，AutoUpdate 维持此前要求的禁用。
- **新功能**：管理员后台「系统管理 → iOS 测试」（前端路由 `/admin/testflight`，菜单 lucide `Rocket`；页面 `frontend/src/pages/admin/TestFlightAdmin.vue`，服务 `testflight.service.ts`）。填姓(lastName)/名(firstName)/邮箱一键邀请 TestFlight **内部**测试员、看状态、重发。后端 `backend/src/modules/testflight/*`：`node:crypto` 自签 ES256 JWT 直调 App Store Connect API（**零新依赖**），路由 `GET /api/testflight/overview`、`GET|POST /api/testflight/testers`、`POST /api/testflight/testers/:id/resend`，整类 AdminGuard；DTO 校验邮箱/姓名。**仅内部测试员、固定 `MARKETING` 最小角色、绝不给 ADMIN、`allAppsVisible:false`、`provisioningAllowed:false`、visibleApps 仅金湖智控**；外部测试本期不做。该迁移刻意不进 schema-readiness 启动硬门禁（可选非运营功能）。
- **苹果侧事实**：App 金湖智控 AdamID `6795375392`、bundle `com.jinhu.smartcontrol`、Team `QZ2W5X359S`；内部组「内部测试」`10b11ad6-6131-4226-9d76-a14d1970b4e7`；最新内部构建 **#40**（processingState VALID，2026-09-09 上传）。后台专用 API 钥 **Key ID `DJ3328P729`（名称 Backend TestFlight，Access=App Manager，仅 TestFlight）**；p8 私钥只存本机 `/Users/mac/MacBook_Backup_20260904/Desktop/APPLE 密钥ID/AuthKey_DJ3328P729.p8`（chmod 600，**禁入 git、禁明文回显**），Admin 钥只留 CI。生产 `backend\.env` 注入 `TESTFLIGHT_ISSUER_ID / TESTFLIGHT_KEY_ID / TESTFLIGHT_P8_BASE64`（P8_BASE64=整份 PEM 文本的 base64；改前备份 `backend\.env.bak-tf-20260919163639`），另有 `TESTFLIGHT_APP_ID/BUNDLE_ID/INTERNAL_GROUP_NAME/TESTER_ROLE/ENABLED` 与 `APPSTORE_*` 回退。已在 GK9000 只读实测：用该钥能拉到 App/内部组/build #40（200）。
- **邀请规则（已验证）**：内部 TestFlight 测试员必须是团队用户且至少一个角色；可行最小请求 `POST /v1/userInvitations`，`attributes:{email,firstName,lastName,roles:['MARKETING'],allAppsVisible:false,provisioningAllowed:false}`，`relationships.visibleApps.data=[{type:'apps',id:'6795375392'}]`；成功 201，重复邮箱 409 即按「邀请已存在/待接受」幂等处理（不产生重复）。重发=先 `DELETE /v1/userInvitations/{id}`（404 可忽略）再 POST。查询用 `/v1/userInvitations?filter[email]=`、`/v1/users?filter[username]=`；内部组字段用 `isInternalGroup`（**不是** `isInternalGroupEnabled`）；最新构建用 `/v1/builds?filter[app]={appId}&sort=-uploadedDate&limit=1&include=preReleaseVersion`（**不是** `/v1/apps/{id}/builds`）。许万玺 `662119@163.com` 已邀请 PENDING（userInvitation `44b18914-87be-4e3a-afe8-492970551ac7`，**2026-09-22 过期**；对方需用该邮箱作 Apple ID 登 iPhone、收 TestFlight 邮件接受、装 build #40；未接受可后台重发）。
- **持锁发布经验（GK9000 含迁移发布的唯一受支持路径，本次走过一遍）**：①`scripts\suspend-gk9000-release.ps1 -Apply -PreReleaseRevision <40位sha>`（建 RELEASE_HOLD+任务快照 `logs\release-pause-*.json`、禁计划任务、停 PM2 守护/双服务/播放器/受管外部进程，结尾停写断言）；②`scripts\reconcile-held-gk9000-release.ps1 -Commit <sha> -TaskSnapshot <快照> -Apply`（持部署锁、构建后端、建 DB+媒体恢复包并隔离恢复演练、跑迁移、再调 resume）；③resume 校验回执/HEAD==origin/main==Commit/干净跟踪区/停写，停服期对前后端各跑 `pnpm install --frozen-lockfile`+`pnpm run build`，脱离会话(WMI)起双服务、verify-deploy、pm2 save、`provision-kiosk-profiles.cjs`、恢复任务并触发交互式 PlayerWatchdog。恢复目录固定 `D:\smart-control-backups\migration-recovery`（本次 `release-xleplZ`，回执 `migration-complete.json`；`productionActivated:false` 是中间态正常现象）。
  - 坑1：停写围栏要求迁移 node 的**父进程命令行**必须是仓库 `reconcile-held-gk9000-release.ps1`/`deploy-from-ci.ps1` 或固定 CI dispatcher，所以必须用独立 `powershell -NoProfile -ExecutionPolicy Bypass -File <仓库脚本>` 启动，不能在临时 .ps1 里直接 `node run-gk9000-migrations.cjs`（否则报 Unexpected migration controller）。
  - 坑2：resume 激活失败的 catch 用 `pm2 stop`（只停应用、**不杀守护**）；重跑 resume 前必须先 `pm2 kill` 清掉残留 PM2 守护，否则第一道停写断言报 “A service or PM2 process remains.”。
  - 坑3：resume 末尾 `provision-kiosk-profiles.cjs` 在 Edge（本机无 Chrome，仅 `C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe`）**首次冷启动 slot profile** 时可能 CDP/迁移超时失败；本次即因此首次激活回滚。profile 预热后（或服务就绪后）重跑 resume 即过。播放器令牌权威源是后端 env `PLAYER_DEVICE_CREDENTIALS`（仅存 sha256+slots），磁盘令牌在 `C:\ProgramData\Anksen\smart-control-player-credentials\{led,projector}.token`。
  - 坑4：resume 前端完整 build 含 `vue-tsc`，GK9000 历史 OOM；SSH 会话先 `$env:NODE_OPTIONS='--max-old-space-size=4096'`（实测 vue-tsc 22s 过）。SSH 默认 shell 是 PowerShell 5.1（无 `&&`/`||`），本地 bash 会吞 `$` 变量——复杂逻辑一律写 .ps1 上传 `powershell -File` 执行。
- 部署最小量化（业主硬约束）：样式/代码小改只构建/重启改动端，不做全量覆盖；但**只要有待办迁移，普通 `scripts\update.ps1` 的 5.4 会被围栏拒绝，必须走上述持锁三步**。GitHub Actions 仍因账户 Billing/runner 在零步骤失败，本次未依赖 CI（功能分支 push 后用 `git push origin feat/...:main` 快进 main）。
- 待办/业主决策：①后台 UI 登录后的实点邀请建议业主登录 `http://192.168.77.54:5173` 从左侧菜单「系统管理→iOS 测试」进入（vite preview 对所有 `/admin/*` 深链硬刷新统一返 404，是既有现象非本次回归，菜单内跳转正常）；②是否撤销旧钥 `8K53TVACBJ`（App Manager，旧标注）由业主定；③是否恢复 GitHub Actions Billing；④`backend/.env.example.windows` 尚未补 TESTFLIGHT 段（`.env.example` 已补）；⑤外部测试员/公开链接以后再做。

## 当前代码上下文（2026-09-17，优先于以下历史快照）

- 当前生产仓库与发布清单均为 `68031a2b19829e82c2e340287a652e1a2b803c0e`（PR #99）；前端运行内容为该提交，后端运行内容仍为 `e545793d4a90001f812eb93f63dcbce9a9251786` 发布时的构建，因为 PR #99 被门禁正确分类为纯前端发布，未重建或重启后端。后端 3200、前端 5173 由 PM2 唯一进程持有，播放器槽位 1 心跳在线，`SmartControl-PlayerWatchdog` 已启用；迁移仍为 40。
- 2026-09-17 LED 现场连续故障已根治：播放器离线由发布隔离停止窗口后恢复了快照中的错误 Disabled watchdog 状态造成；PR #98（合并 `e545793`）使激活始终启用并触发交互式 watchdog，部署门禁现在必须看到 slot1 新鲜心跳才成功。运营大屏播控翻页失效则由 iframe 缺少 `allow-same-origin`、安全收紧后轮询请求成为 `Origin: null` 并被 CORS 拦截造成；PR #99 只给同源内置 `park-ops/index.html` 恢复同源能力，外部网页继续隔离，并修复翻页动画窗口吞指令。
- PR #98 全量发布备份为 `D:\smart-control-backups\20260917-094159\sqlite-rpCHEh\database.sqlite`；PR #99 前端旁路发布备份为 `D:\smart-control-backups\20260917-095611\sqlite-jboNfh\database.sqlite`。后者发布前后 41 张表仅 `dali_light` 与 `playback_channels` 的探活字段变化，完整性 `ok`、外键违规 0；现场翻页控制回环 `1→2→1` 通过。PR #98 本地后端 87 套件/735 项、前端 80 项和运维 66 项通过；PR #99 前端 82 项、类型检查和 129 资源 PWA 构建通过。GitHub Actions 仍因 Billing 在任务启动前零步骤失败。
- 阶段 P2-A6 已完成首批模块边界拆分：`MediaPage` 内重复的音频、视频、文档扩展名、拖放校验、大小/时长格式化和目录递归已收敛到 `media-file-intake.ts` 纯模块；媒体库页面直接使用该模块，`media.service` 只保留兼容转发，使 `PlayerConsole` 与媒体页继续共享同一文件选择策略。页面减少 73 行内嵌职责，契约测试禁止两处重新定义扩展名权威。
- P2-A6 本地门禁：前端 79 项、类型检查和生产构建，后端 87 套件/735 项及构建，运维 67 项（65 通过/2 环境跳过），全新临时数据库、真实后端和真实浏览器验收全部通过。PR #94 代码提交 `e0c5dc782e719a5111531460b4db078eaf824dff`、合并提交 `0f96acc9ae532c6ca82a2ef60702f52bcc666bab` 已发布；备份为 `D:\smart-control-backups\20260917-085434\sqlite-ITjDsW\database.sqlite`。生产当前 PWA 89 个资源、上一代 88 个资源、9 个页面、后端健康和公网 HTTPS 通过；17 张权威表与备份一致，`video.binding` revision 1/history 1 及 6 路几何不变，完整性 `ok`、外键违规 0。GitHub Actions 仍因 Billing 在任务启动前零步骤失败；阶段 2 下一批继续按行为边界拆分超大模块。
- 阶段 P2-A5 已完成：NVR、通道、删除、布局、AI 全局开关和检测几何共用同一 `expectedRevision` 并发契约；新前端所有持久化写入都提交当前修订，过期写入稳定返回 HTTP 409 + `VIDEO_BINDING_REVISION_CONFLICT`。错误过滤器只传递白名单机器码与修订元数据，不回显任意异常字段；缺失资源使用稳定 404，无变化写入不再新增修订，新修订记录命名管理员和稳定 API 来源。
- 同批根治了管理员会话偶发丢失：启动时客户端和管理员令牌并发恢复，会主动中止旧读取；旧逻辑将这种 `AbortError` 当作凭据无效并删除新会话。现在会话检查按令牌去重、重新同步 HTTP 凭据、主动中止重试一次，临时断网保留凭据，只有服务端明确 401/403 才清除。两轮全新数据库/进程/浏览器验收均覆盖“后台登录→返回灯光→整页刷新→真实控制”并通过。
- P2-A5 本地门禁：后端 87 套件/735 项，前端 75 项+类型检查，运维 67 项（65 通过/2 环境跳过），双端生产构建、相关 ESLint 和两轮真实浏览器验收通过。生产发布后 17 张权威表与备份逐表一致，`video.binding` 仍为 revision 1/history 1，6 路几何不变，完整性 `ok`、外键违规 0；新旧 PWA 各 88 个资源、9 个页面、公网 HTTPS 与 `camera=(self)` 通过。GitHub Actions 仍因账户 Billing 在任务启动前零步骤失败；恢复计费后需恢复远端自动门禁。
- P1-A19 完成时的生产 Git 基线为 `18b138be42b9750316161d0070c1f0a40fa3d64f`（PR #76）。当时后端 3200、前端 5173、PM2 守护和计划任务均通过权威验证；`RELEASE_HOLD` 不存在。生产健康接口为 200，38 台设备在线、0 离线，六路 HLS 运行中且零重启。SQLite 共 38 个迁移，`integrity_check=ok`、外键违规 0。
- 阶段 P1-A3 已完成：视频绑定、2 台 NVR、6 路通道、HLS、截图、检测线与 ROI 收敛到 SQLite 的 `video.binding` 单一权威文档；后台编辑只写数据库并保留 revision、校验和及操作者历史，旧 JSON 仅作为已冻结的迁移来源。
- 生产已执行 `ImportVideoBindingRuntimeConfig1789560000000`，迁移总数 28；`video.binding` 为 schema v1 / revision 1，当前文档与唯一历史记录校验和一致，`integrity_check=ok`、外键违规 0。源 `video-binding.json` SHA-256 保持 `febfdd42ad95319a5b993bf6ffeb65a38a52695b32d50f195092bf03abddac2f`，其归一化内容与 SQLite 逐字段一致。
- PR #40（`f7ddd8d`）首次真实迁移在停写复核处安全失败，未改数据库；PR #41/#42/#43 分别修正控制器父进程判定、PowerShell 5.1 原生错误采集和绝对迁移入口。随后在原 hold 下完成同一次恢复演练、迁移、回执和激活，未删除 hold 重跑、未回滚数据。
- 迁移恢复包与回执位于 `D:\smart-control-backups\migration-recovery\release-HT0Ypw`；发布前备份 `D:\smart-control-backups\20260916-163442` 以及旧恢复证据 `D:\smart-control-backups\20260916-143539`、`release-4qG9Uv` 必须永久保留。
- PR #44 修复 HLS 固定状态路由被通用 `:filename` 路由遮蔽的问题。生产六路 `hls/status` 均为 HTTP 200、`isRunning=true`、`restartCount=0`；六路播放列表各有 3 个新鲜分片，对外接口不泄露 NVR 密码。
- 阶段 P1-A4 已完成：园区运营指标、文案和占位标记收敛到 SQLite 的 `park.ops.metrics` 单一权威文档。生产迁移总数 29；schema v1 / revision 1，唯一历史记录来源为 `legacy-json:park-ops-metrics.json`，旧文件只读保留且 SHA-256 仍为 `8d4fb387b9944907c7ea73d77ca871d929f4408db0b3f608ed2e78ecda8dc938`。数据库文档、历史修订、规范化旧文件和公开 API 完全一致，保留 56 个指标、14 组文案和 29 个占位标记。
- PR #46 首次自动发布在迁移开始前被写入者门禁安全拦截，数据库保持 28 个迁移。根因是已安装 CI 调度器在同一 PowerShell 进程内调用仓库脚本，父进程命令行不含仓库脚本路径。PR #47 仅接受固定调度器路径、`gk9000-deploy` 动作及当前 40 位提交号三重匹配；在原 hold 与暂停快照下完成恢复，未删除 hold 重跑。
- P1-A4 发布前备份为 `D:\smart-control-backups\20260916-174947`，迁移恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-jviFeA`。生产数据库 `integrity_check=ok`、外键违规 0；六路 HLS 均为 200/运行中/零重启。上述证据以及 P1-A3 的 `release-HT0Ypw` 均须保留。
- 阶段 P1-A5 已完成：音频矩阵期望状态只保留 SQLite `audio_desired_link`。生产 `matrix-state.json` 原本就不存在；旧只读接口现从数据库映射兼容格式，旧写接口返回 410 `AUDIO_MATRIX_LEGACY_WRITE_RETIRED`，不能重新生成第二份文件源。生产 64 条 8×8 期望路由、8 条启用项均未改变，迁移仍为 29，数据库完整性与六路 HLS 均正常。
- 阶段 P1-A6 已完成：园区大屏页码、自动播放和一次性刷新均为 `ParkOpsControlService` 进程内短期状态，重启恢复安全默认值，不再写 `park-ops-control.json(.bak)`。生产预检和发布后均确认两个文件不存在，无历史状态需要迁移。仅大屏轮询 GET 公开，所有变更接口仍需登录；PWA 控制与拍照上屏后的回首页请求已统一通过共享 API 客户端携带身份。生产匿名 POST 返回 401，公开 GET 返回 6 页安全默认状态。
- 阶段 P1-A7 已完成：`/api/system/info` 从环境、Git 和仓库外发布清单解析准确提交、分支和发布时间，不再返回空 commit/ref，也不再用静态模板伪造平台和主机名。管理员运行摘要统一输出实际 SQLite 路径/版本、迁移状态、运行配置文档数、数据目录、媒体根和日志目录；配置路径与真实连接路径分叉时启动失败。生产发布清单为 `D:\smart-control-runtime\data\release.json`；当前发布清单、运行 API 与 Git HEAD 均为 `dd66bd3`。
- 阶段 P1-A8/A9 已完成：修复固定 Windows 调度器使用上一版部署脚本导致门禁改动晚一轮生效的问题。调度器先验证目标提交属于 `origin/main`，从该提交提取并解析部署脚本；发布验证后再原子同步自身。Windows `File.Replace` 使用同目录临时备份路径，禁止空备份路径。生产仓库与系统调度器 SHA-256 均为 `90e18a0d73660b919ddf36f3fe7bb7e318cc98e61e4c6d9540c6dea18f18fd63`，无 `.tmp/.previous` 残留。
- 阶段 P1-A10 已完成：系统品牌与场景动作原本已分别以 SQLite `system_branding_v2`、`scenes/scene_actions` 为权威源；其中混在品牌表的园区大屏布局已迁入版本化 `park.ops.visual` 文档。生产为 schema v1 / revision 1，当前文档、唯一历史和冻结旧字段的 SHA-256 均为 `ae26406019afad20848797177f22453e1c2c9fd88693d98c781bbeddf65589a9`。品牌默认行改由第 30 个迁移幂等建立，服务启动不再读写 Logo 资产或哨兵文件；旧编辑器仍兼容，新编辑器携带 revision，过期写入返回 409。
- P1-A10 发布前备份为 `D:\smart-control-backups\20260917-002713`，配套恢复包与迁移回执为 `D:\smart-control-backups\migration-recovery\release-Tnr3QE`。生产数据库 30 个迁移、完整性 `ok`、外键违规 0；Logo 校验和、4 个场景、142 个动作和 81 条媒体记录迁移前后不变。PR #57 部署任务为 https://github.com/ivanzhao299/smart-control/actions/runs/35121736551。
- 阶段 P1-A11 已完成：`VideoBindingService` 和 `ParkOpsMetricsService` 启动时只读 SQLite，不再检查、解析或回灌 `video-binding.json(.bak)` / `park-ops-metrics.json(.bak)`。新库由第 31 个迁移建立确定性的 `video.binding` 默认 revision 1；已有文档严格跳过。视频权威文档缺失时应用明确拒绝启动，运营指标尚未发布时保持空值，首次后台保存再建立 revision 1。
- P1-A11 发布前备份为 `D:\smart-control-backups\20260917-005849`（SQLite `sqlite-KsbYop\database.sqlite`），配套恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-NkI9R2`。生产仅新增 `EnsureVideoBindingRuntimeConfig1789590000000` 迁移账本；三份运行配置仍各为 revision 1 / history 1，SHA-256 发布前后分别保持 `0ac39f8f…9406`、`8d4fb387…c938`、`ae264060…89a9`。数据库完整性 `ok`、外键违规 0，4 场景/142 动作/81 媒体不变。PR #59 与部署任务：https://github.com/ivanzhao299/smart-control/pull/59、https://github.com/ivanzhao299/smart-control/actions/runs/35124987729。
- 阶段 P1-A12 已完成：删除 `ScenesService` 的启动修复器，不再依赖 `scene-actions-v2.done` 哨兵，也不再在服务启动时删除并重建四个推荐场景的动作。部署 seed 只在某个场景完全没有动作时补齐新安装默认值；已配置场景不会被覆盖。历史哨兵保留为审计证据但应用不读取。
- P1-A12 无数据库迁移、无设备命令。发布前备份为 `D:\smart-control-backups\20260917-011550`（SQLite `sqlite-urufJS\database.sqlite`）。生产仍为 31 个迁移、4 个场景、142 个动作和 81 条媒体；四个场景发布前后逐字段 SHA-256 分别保持 `58876e0b…d871`、`52fb3826…662e`、`bffbc28c…42b8`、`901b6fbb…72a6`。三份运行配置 revision/history/hash 不变，数据库完整性 `ok`、外键违规 0。PR #61 与部署任务：https://github.com/ivanzhao299/smart-control/pull/61、https://github.com/ivanzhao299/smart-control/actions/runs/35126749747。
- 阶段 P1-A13 已完成：`PowerCircuitsService` 启动只读，不再逐编码补建回路，也不再强制修正 LED 总闸和 `seq-4`/`seq-5` 通道。第 32 个迁移仅在整张 `power_circuit` 为空时建立 14 条新安装默认值；LED 修复只匹配旧网关与旧通道签名，时序器只匹配 4/5 精确对调，其他人工配置不改写。含权威回路时禁止无归档降级。
- P1-A13 发布前备份为 `D:\smart-control-backups\20260917-013621`（SQLite `sqlite-dcXP3V\database.sqlite`），迁移恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-nvnwgD`。生产只新增 `EstablishPowerCircuitDefaults1789600000000` 迁移账本；14 条回路逐字段 SHA-256 发布前后保持 `72d65fe0…d61d`，4 场景/142 动作/81 媒体与三份运行配置均不变，完整性 `ok`、外键违规 0。PR #63 与部署任务：https://github.com/ivanzhao299/smart-control/pull/63、https://github.com/ivanzhao299/smart-control/actions/runs/35128885502。
- 阶段 P1-A14 已完成：`DriverRegistryService` 启动只读，不再把适配器元数据无条件覆盖到 `driver_templates`；适配器中的八份重复 `describe()` 已删除。第 33 个迁移保存不可变的内置目录快照，仅补不存在的 kind；已有同名模板、禁用状态和现场自定义模板逐字节保留，后续目录升级必须新增显式迁移。
- P1-A14 发布前备份为 `D:\smart-control-backups\20260917-020733`（SQLite `sqlite-FgmwGb\database.sqlite`），迁移恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-q7WJ1S`。备份库为 32 个迁移、生产库为 33 个迁移，两者 8 条驱动模板 SHA-256 均为 `51af7d60…e1960`；4 场景/142 动作/81 媒体、14 条电源回路和三份运行配置均不变，完整性 `ok`、外键违规 0。PR #65 与部署任务：https://github.com/ivanzhao299/smart-control/pull/65、https://github.com/ivanzhao299/smart-control/actions/runs/35132094732。
- 阶段 P1-A15 已完成：`BrandsService` 启动只读，不再扫描硬件与驱动后延迟补品牌。第 34 个迁移建立 12 条产品品牌快照并补齐已有引用，只插入缺失名称；已有品牌的启用状态、Logo、联系方式、备注及自定义品牌完整保留。新增/修改硬件厂商和新增自定义驱动时，在同一业务操作中即时补齐品牌目录。
- P1-A15 发布前备份为 `D:\smart-control-backups\20260917-022829`（SQLite `sqlite-feijSH\database.sqlite`），迁移恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-RT80Vp`。备份与生产的 12 条品牌语义 SHA-256 均为 `58bd22ed…d036`，品牌、8 条驱动模板、14 条电源回路、4 场景/142 动作、三份运行配置和 81 条媒体记录逐表一致；数据库完整性 `ok`、外键违规 0。PR #67 与部署任务：https://github.com/ivanzhao299/smart-control/pull/67、https://github.com/ivanzhao299/smart-control/actions/runs/35134334223。
- 阶段 P1-A16 已完成：`AudioConfigService` 启动只读，不再为空表灌入默认输出/输入/场景/路由，不再按旧输入名清空重建接线，也不再在重启时修正立体声名称。第 35 个迁移建立全新库音频目录并承接精确历史签名修复；管理员修改 OUT1-4 名称时改为在单个数据库事务中同步左右声道。
- P1-A16 发布前备份为 `D:\smart-control-backups\20260917-025436`（SQLite `sqlite-5Jmr2a\database.sqlite`），迁移恢复包与回执为 `D:\smart-control-backups\migration-recovery\release-taRrPn`。备份与生产的 8 输出、8 输入、12 场景、64 路由逐字段一致；语义 SHA-256 分别为 `73d5dea9…a1f0`、`94354736…056e`、`7179abb9…a744`、`4a34c524…ae1a`。其他受保护表不变，完整性 `ok`、外键违规 0。PR #69 与部署任务：https://github.com/ivanzhao299/smart-control/pull/69、https://github.com/ivanzhao299/smart-control/actions/runs/35136973551。
- 阶段 P1-A17 已完成：`app_release_v1` 是客户端查询与管理员维护发布策略的唯一运行时来源；`AppReleaseService` 启动只读，不再读取仓库 manifest 或重写版本、说明和启用状态。第 36 个迁移增加产物来源、提交、SHA-256、大小与构建时间；随包 Android 元数据只允许部署 reconciler 在校验 APK 后原子更新，管理员仍可维护发布说明、强制更新和最低版本策略。
- P1-A17 首次发布已成功完成迁移和回执，但安卓工作流在迁移期间为同一版本提交了新 APK，使远端 main 前进；门禁正确保留 `RELEASE_HOLD` 并停止激活，没有代码或数据回滚。恢复脚本只接受祖先关系成立且差异严格为 manifest+APK 的目标提交，验证原回执后前滚到 `ed69863`；随后 PR #72 消除工作流自触发和双发布竞态，标准部署到 `6804d6f` 全绿。原备份 `D:\smart-control-backups\20260917-033608\sqlite-VXziBu\database.sqlite`、恢复包/两份回执 `D:\smart-control-backups\migration-recovery\release-coIVpz` 和暂停快照必须保留。生产发布记录保持 v1.1.14/code 22、原说明与策略，产物 SHA-256 为 `79229763…6fa1`，大小 5,893,727 字节；PR #71/#72 与最终部署：https://github.com/ivanzhao299/smart-control/pull/71、https://github.com/ivanzhao299/smart-control/pull/72、https://github.com/ivanzhao299/smart-control/actions/runs/35142909288。
- 阶段 P1-A18 已完成：`users` 是 PWA 与后台新登录的唯一凭据源；共享客户端/后台密码不再提供登录、修改或重置，旧令牌只按原有效期兼容。后台要求个人 `admin` 角色并签发 8 小时令牌，PWA 个人令牌保持 30 天；全局鉴权优先解析显式后台 bearer，避免并存的操作员 PWA 会话遮蔽管理员身份。
- P1-A18 删除两个认证服务的启动写入和 seed 的 `admin/admin123`，第 37 个迁移只为缺失的新库建立不可登录占位配置；首次管理员改由 `pnpm run admin:provision` 显式、原子创建。生产已有 4 个启用账号（1 管理员、3 操作员）以及 `admin_auth_v1`、`client_auth_v1` 的密码哈希、签名密钥和时间字段，与发布前恢复库逐字段一致。两张认证表各恰有 id=1 且密钥长度 64，最后管理员保护触发器完整。
- P1-A18 恢复包为 `D:\smart-control-backups\migration-recovery\release-ifx7MU`，隔离恢复演练为 `D:\smart-control-backups\migration-recovery\restore-2wTp5V`。PR #74 合并提交 `65d67d0`，生产部署 https://github.com/ivanzhao299/smart-control/actions/runs/35147034133 全绿；数据库 37 个迁移、完整性 `ok`、外键违规 0，密码单字段登录均返回 400，PWA 控制/灯光/大屏页面均为 200，38 台设备在线，六路 HLS 运行中且零重启。
- 阶段 P1-A19 已完成：旧 `SeedService` 的场景/动作、逻辑设备、硬件、灯光分区/组和 UAT 目录冻结为 `EstablishOperationalCatalog1789660000000` 不可变快照。第 38 个迁移只补缺失行、只为空动作场景建立推荐动作、只对精确旧签名修复；不删除任何已有场景、分区或自定义数据。发布、包脚本和人工运维均不再存在 seed 入口。
- P1-A19 发布前在生产在线一致性副本上演练，第 38 个迁移除迁移账本外 40 张业务表指纹全部不变，重复执行为 0 项。正式恢复包为 `D:\smart-control-backups\migration-recovery\release-87e6u8`，隔离恢复演练为 `D:\smart-control-backups\migration-recovery\restore-lbiONb`，发布前备份为 `D:\smart-control-backups\20260917-051004\sqlite-ThRC7w\database.sqlite`。PR #76 合并提交 `18b138be`，生产部署 https://github.com/ivanzhao299/smart-control/actions/runs/35150526034 全绿。
- 现场权威路径：SQLite=`D:\smart-control\database\smart-control.db`，运行时数据=`D:\smart-control-runtime\data`，媒体=`D:\Media`，拍照上墙照片=`D:\Media\welcome-photos`。以上目录与代码仓库分离，发布不得删除或覆盖。
- 阶段 P1-A20 已完成：`hvac_zone`、`hvac_indoor.zone_code` 与 `playback_channels` 分别成为空调分区/成员和物理播放通道的唯一权威目录。第 39 个迁移只在对应整表为空时建立 14/22/3 条新安装默认值，非空、部分、禁用和定制目录零改写；读取与启动不再补行。`hvac-zone` 场景动作改为查询数据库成员，已删除第二份运行时代码常量；遗留 `hvac_zone.indoors` 不再承载成员关系。
- P1-A20 生产发布前在线一致性副本的 40 张业务表指纹全部不变；正式备份为 `D:\smart-control-backups\20260917-054502\sqlite-diWIgb\database.sqlite`，恢复包为 `D:\smart-control-backups\migration-recovery\release-lo47Nf`，隔离恢复演练为 `D:\smart-control-backups\migration-recovery\restore-uBi16p`。PR #78 合并提交 `acfbd56a4e69aa8008c56e4c4c46cc4998ba9d05`，生产部署 https://github.com/ivanzhao299/smart-control/actions/runs/35153802363 全绿。
- 阶段 P1-A21 已完成：15 条内置媒体纳入 `bundled-media-manifest.json` 版本 1 清单；第 40 个迁移建立稳定 `system_key`、制品 SHA-256 与唯一索引，并承接旧 M4V MIME 修复。`MediaService` 启动只读，不再建档、复制或修复文件；系统媒体禁止通用 API 编辑删除，前端显示“内置/受保护”。部署 reconciler 只在数据库/媒体配套恢复门禁内写入，发布和回执复核使用只读检查。
- P1-A21 正式备份为 `D:\smart-control-backups\20260917-062105\sqlite-6OuZOa\database.sqlite`，恢复包/回执/隔离演练为 `D:\smart-control-backups\migration-recovery\release-lyzijF`。PR #80 合并提交 `28e6f6caedca3b110fdd3e095257c0c37a35e459`，生产部署 https://github.com/ivanzhao299/smart-control/actions/runs/35156942185 全绿；生产 40 个迁移、15 个唯一系统键、13 个文件摘要，文件全部保留原路径且未创建 `_system`，完整性 `ok`、外键违规 0，双服务 HTTP 200/在线/零重启。
- 阶段 P1-A22 已完成并退出阶段 1：非迁移运行代码禁止退役 JSON 和结构 DDL，15 个启动钩子固定为精确白名单；品牌 singleton 与 `video.binding` 当前/历史修订在启动前校验，缺失时拒绝启动或保存，不再默认重建。PR #82 合并提交 `a4bd519dc0460526daba399a9f3c21cd68c94476` 已通过受限网关发布。发布前备份为 `D:\smart-control-backups\20260917-065958\sqlite-c1HbNJ\database.sqlite`；生产 40 个迁移、17 张权威表与备份逐表计数/SHA-256 一致，完整性 `ok`、外键违规 0，代码/远端/发布清单一致，5 个入口 HTTP 200。
- `release-lyzijF` 已复制到跳板机 `/var/backups/smart-control`，87 个文件、4,220,164,447 字节；首次 `OFFSITE_BUNDLE_VERIFIED`、重复执行 `OFFSITE_BUNDLE_CURRENT`，提交关联和三类摘要一致，无临时目录。该基线覆盖发生迁移的发布；普通 6 小时快照和新增媒体的持续异机 RPO 留在阶段 3。GitHub Actions 当次因账户 Billing 在任务启动前拒绝运行，代码已在本地和生产完整门禁验证；需修复 Billing 恢复远端自动执行。下一批进入阶段 2 的模块、API 与关键用户旅程收敛。
- 阶段 P2-A1 已完成：主 PWA 的 11 个页面路由、9 个可见导航项、空闲/指针分块预取和 API 预取统一由 `main-route-manifest.ts` 生成，两个 DALI 深链保留，`App.vue` 重复导入表已删除。PR #84 合并提交 `0af96e8ddbe1515b6ae81a3d6d609dd0f66ed438` 已发布；发布前备份为 `D:\smart-control-backups\20260917-071034\sqlite-Yw29Hx\database.sqlite`。
- 阶段 P2-A2 已完成：发现旧部署门禁只识别 Workbox 的 `"url":"..."`，真实压缩产物使用 `url:"..."`，因而错误报告保留 0 个上一代分块，可能让持有旧 Service Worker 的 iPhone 只显示底部壳而页面黑屏。先从只读回滚快照追加恢复 44 个缺失分块，再让门禁兼容两种格式，并对空清单、源文件缺失、路径越界和复制后缺失全部失败关闭。PR #85 合并提交 `7a97b8e5a8b5d76d61df1528666b95b8db3d15a2` 已发布；备份为 `D:\smart-control-backups\20260917-071639\sqlite-6djZm3\database.sqlite`。
- P2-A2 生产验收：当前和上一代 Service Worker 各引用 88 个资源，均在前端发布目录且通过 HTTP 200 与 JS/CSS MIME 核验；9 个 PWA 页面入口均为 200。发布前后 17 张权威表逐表计数和规范化 SHA-256 一致，迁移 40、`integrity_check=ok`、外键违规 0。GitHub Actions 因账户 Billing 在任务开始前零步骤失败，本批使用完整本地门禁和受限生产网关完成验证。阶段 2 尚未完成，下一批建立登录、灯光、大屏投放、拍照上屏、媒体上传、视频绑定与检测范围保存的关键旅程门禁，再按行为边界拆分大模块。
- 阶段 P2-A3 已完成：iPhone 页内相机只能在 HTTPS 安全上下文使用，生产规范入口为 `https://park.cnjinhu.com/control/`；HTTP 入口无法由页面绕过浏览器限制，错误页现明确引导重新登录并重新添加 HTTPS PWA。继续使用 `getUserMedia + canvas`，不恢复曾触发 iOS PWA 闪退的 `input capture` 系统相机路径。
- 拍照上屏发布已提取为可测试事务边界：读取旧绑定→上传新图→绑定新图→切换欢迎页→可恢复删除旧图。绑定失败时只尽力回收新上传，旧绑定和旧照片不动；切屏或旧图回收失败不撤销已确认的新绑定。生产照片目录仍为数据盘 `D:\Media\welcome-photos`。
- 视频检测范围编辑器现在携带 SQLite 配置修订号，过期保存返回 `VIDEO_BINDING_REVISION_CONFLICT`；只有服务端保存成功且重新读取的检测线、ROI、AI 状态完全一致后才关闭。请求失败、并发冲突或回读不一致均保留当前画布，避免“保存失败却关闭编辑器”造成误以为数据丢失。旧 PWA 可缺省修订号，保持滚动升级兼容。
- P2-A3 对应 PR #87，合并提交 `33c5e363101b7d5937b7e3b98de72bb0da81d328` 已发布；备份为 `D:\smart-control-backups\20260917-073157\sqlite-c8j8DJ\database.sqlite`。前端 66 项、后端 86 套件/730 项、双端构建、运维 67 项（65 通过/2 环境跳过）和双端生产依赖审计均通过。生产独立验收确认 17 张权威表零变化，`video.binding` revision 1/history 1、6 路状态和几何点数与备份一致，数据库迁移 40/完整性 `ok`/外键违规 0；新旧 PWA 各 88 个资源、9 个入口和公网 HTTPS 均通过。GitHub Actions 仍因账户 Billing 在任务开始前零步骤失败。阶段 2 下一批继续登录、灯光、大屏投放、通用媒体上传与视频绑定其他写入路径。
- 阶段 P2-A4 已完成：浏览器不再保存 `sc.client.savedPassword` 明文或静默使用密码登录，只保留签名令牌和服务器绑定的用户名，旧明文在启动迁移时清除；原生壳的加密生物识别存储保持用户主动触发。灯光命令按分区保持单个在途请求，只有服务端确认后提交状态，失败同时恢复开关和亮度。
- 大屏偶发空闲/黑屏的直接根因是实时变更事件落在启动状态请求仍在途的窗口内：旧逻辑丢弃这次刷新，页面会停在过期空闲状态直到下一轮 30 秒轮询。播放器现在记录在途期间的失效事件并紧接着补读，三路通道浏览器验收均覆盖该竞态。
- P2-A4 对应 PR #89，代码提交 `c13b976f63d2544844617b69c5abf1d66fbadd49`、合并提交 `e9ec3b71c9724dc06d506318d3fe88f33fe2714b` 已发布；备份为 `D:\smart-control-backups\20260917-081957\sqlite-NH2vqV\database.sqlite`。前端 72 项、后端 86 套件/730 项、双端构建、运维 67 项（65 通过/2 环境跳过）、双端生产依赖审计及一次性真实浏览器验收通过。生产采用纯前端旁路构建，后端未重启、无迁移；17 张权威表与备份完全一致，`video.binding` revision 1/history 1 及 6 路几何不变，数据库完整性 `ok`、外键违规 0；新旧 PWA 各 88 个资源、9 个页面、公网 HTTPS 和 `camera=(self)` 均通过。GitHub Actions 因账户 Billing 在任务启动前零步骤失败，需恢复计费后重启远端自动门禁。阶段 2 下一批继续视频绑定其余写入契约和大模块按行为边界拆分。

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
