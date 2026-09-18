# 本机阶段 2 接续记录 — 2026-09-18

## 权威位置与边界

- 工作树 `/Users/mac/.codex/worktrees/smart-control-local-takeover-20260917`，分支 `codex/p2-hvac-state-boundary-20260917`。不要在空的 `/Users/mac/Documents/smart conrtol` 当作项目工作树执行。
- 上一工程目标轮为有效进展：C05 实现/验收已完成本地证据，本轮复核并提交 `4a15c9d`；不是重复状态汇报或等待。C06 本轮继续实际实现后端及媒体引用保护。
- 使用 Node 20 与 pnpm 10.33.4；只在合成 SQLite、loopback Mock 后端测试。未推送、PR、合并、生产发布、GK9000 重启或现场设备操作。
- 所有阶段 2/3/4 要求仍以执行计划及配置固定清单为准。总体目标 active；自托管构建机暂停；不得用本地测试代替生产验收。
- Codex 只使用 OpenAI/ChatGPT，DeepSeek 永久禁止。全局 AGENTS 的该规则优先于旧历史接入说明。

## 本轮变更与证据

- C05：`docs/BRAND_CONFIGURATION_CONTRACT.md`，本地提交 `4a15c9d`，930 后端 / 200 前端、双端构建、68 运维通过 + 2 环境跳过、完整本地浏览器。
- C06 后端：`docs/SYSTEM_BRANDING_CONFIGURATION_CONTRACT.md`，迁移 44、严格 editor、单行共享 CAS、管理员复核、原子脱敏审计，媒体引用/删除保护及当前图片公开边界。975 后端 / 200 既有前端通过；最终本地浏览器状态查契约与 `/tmp/smart-control-system-branding-63EZM0/`。
- 生产最后版本不可由本文件推断；部署前重新取证候选/远端合并/实际运行 SHA。累计候选迁移 41–44 尚需真实生产副本升级与授权发布。

## 下一批准确入口（C06 尚未完成）

1. `frontend/src/services/system-branding.service.ts`：定义只读修订号和可写字段白名单，新前端用 `/editor`、`/welcome/editor`；不得在提交时自动重读版本掩盖旧草稿覆盖。
2. `frontend/src/stores/system-branding.ts` 与 `pages/admin/SystemBrandingAdmin.vue`：读取失败不能把 fallback 当作可写基线；冻结提交，保存期间继续输入保留；明确确认重读，身份/服务器切换使晚回执失效。Logo 压缩异步回调也必须有身份/草稿边界。Favicon 缓存参数仍按长度计算，需要改为确认修订号。
3. `frontend/src/components/PlayerConsole.vue` 欢迎编辑段：独立版本与草稿生命周期，先保存配置；现有“正在欢迎页时重推”属设备操作，Mock 验证与真实现场验收分开。`MediaPage.vue` 的设为/取消欢迎页也要明确旧基线。
4. `frontend/src/services/welcome-photo-publisher.ts` / `composables/useWelcomePhoto.ts`：下方续批已修复发布阶段的读取失败禁写、一次带版本绑定、回执不确定时只读核实，不盲删/自动重试。剩余：完整 UI/IDB 生命周期、撤下流程、冲突/不确定状态的明确重读入口及浏览器联合验收。
5. 拍照全过程与撤下要绑定原账号/服务器，IDB 原画状态不可跨身份泄漏；保持长边 1920 / JPEG 0.82 与原画只留本机、不自动弹分享的现有 iPhone 防闪退措施。
6. 补前端单测和实际浏览器保存/409/读取失败/换身份/上传绑定回执丢失/撤下/并发回收。`welcome-photo-publish-journey.test.cjs` 已替换“任何绑定失败都删新文件”的错误断言；不代表完整页面或真机旅程通过。
7. 核对 C06 固定退出证据后再进入 C07；继续保留 C07–C12、结构拆分/依赖方向及阶段 3/4，不缩减目标。

## 本机工具注意

Context Mode 之前实际 cwd 为 `/Users/mac/Documents/smart conrtol`，不匹配上述工作树。按全局规则使用普通定向工具，不将本项目资料索引进错误作用域；首次再用必须重新核验。

## 2026-09-18 续批：照片发布回执与版本边界

- 本轮为有效工程进展，不是等待：修改服务及真实调用方，新增 5 项针对性测试（照片旅程现 9 项）。照片发布使用 `/welcome/editor` 与上传前读取的版本；不在提交前偷偷重读覆盖基线。
- 读取失败/版本缺失不上传；绑定异常仅只读核实一次，确认新绑定和版本推进才继续。不能确认时保留文件供核对，不重试写、不删除新旧图、不触发切页。
- 发布各异步步骤核对账号/服务器 generation；相册压缩前捕获同一身份，延迟原画保存启动前再核对。原生上传去除无幂等键自动重试；切页失败不再声称已切页。
- Node 20：照片旅程与现有身份边界合计 28/28 通过；`pnpm@10.33.4 exec vue-tsc --noEmit` 通过；`git diff --check` 通过。此次没有重跑全量或浏览器，不沿用之前全量通过证明新改动。
- 尚未闭合：组件卸载/拍摄开始时的身份边界、原生上传取消与超时、IDB 按账号/服务器隔离、`loadCurrent` 与 `saveOriginal` 晚回执/读取失败、`takeDown` 版本与不确定状态流程、所有编辑页统一版本入口及真实浏览器验证。这些是下一批的确定入口，C06 仍未完成。
- 未推送、部署、重启或访问生产设备；保持 OpenAI/ChatGPT 配置不变。
