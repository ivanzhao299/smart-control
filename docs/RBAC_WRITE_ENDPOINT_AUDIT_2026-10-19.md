# 写端点授权审计与裸奔护栏（动态 RBAC P5）

- 日期：2026-10-19
- 范围：`backend/src/modules` 下全部 `*.controller.ts` 的写端点（POST/PUT/PATCH/DELETE）
- 对应规划：动态角色权限 RBAC 规划报告 §7.2（新旧守卫过渡）、§9.3（安全防护清单）
- 配套测试：`backend/test/naked-write-endpoint-scan.test.cjs`（ops 测试，`pnpm run test:ops` 执行）

## 1. 为什么要做这次审计

全局守卫 `GlobalAuthGuard`（`app.module.ts` 以 `APP_GUARD` 注册）只负责**认证**，不负责**功能授权**：

1. 方法/类标了 `@Public()` 的请求直接放行；
2. 非 `@Public` 请求必须携带有效 token，否则 401；
3. `viewer`（只读账户）的写请求在全局门被直接 403。

也就是说，**全局门只保证“你是谁”，不保证“你能不能干这件事”**。一个非 `@Public` 的写端点，如果方法/类上没有任何功能授权守卫或权限装饰器，那么任何登录角色（operator/hardware/config/property 等）都能调用它。前端隐藏按钮不是安全边界，后端必须显式声明授权。

## 2. 判定口径

静态扫描每个写端点的装饰器栈（方法级 + 类级），分三类：

- **protected（已授权）**：方法或类装饰器栈含功能授权信号
  `@RequirePermission`、`@UseGuards(<授权守卫>)`、`@ModuleAccess`、`@Roles`、`@WriteRoles`、
  `@ActorAdmin`，授权守卫包括 `ModuleAccessGuard / RolesGuard / WriteRoleGuard / ActorAdminGuard /
  PermissionGuard / BackendSessionGuard / PlaybackOperatorGuard / MediaUploadGuard /
  PowerDomainGuard` 等。
  类级标了 `@Public` 但方法上另挂 `@UseGuards(PermissionGuard/ModuleAccessGuard)` 的，
  方法级守卫独立生效，仍判为 protected（已用 curl 验证：物业 token 调 `em123/readout`、`sync` 返回 403）。
- **public（显式公开）**：方法或类标 `@Public`，且方法上没有功能授权守卫。
- **naked（裸奔）**：既不是 `@Public`，也没有任何功能授权装饰器。

注意：`ParkOpsGuard`（运营大屏接管锁）、`RateLimitGuard`（限流）、设备凭据守卫属于“公开通道”的
接管锁/限流/设备认证，叠加在 `@Public` 方法上时该端点仍是**显式公开**，计入 public，不算功能授权。

扫描器对装饰器栈的处理要点（避免误判）：方法装饰器同时收集 HTTP 方法装饰器上方与下方的连续
`@` 行；类装饰器只取 `export class` 正上方紧邻的栈，不把文件头 `import` 计入。

## 3. 结果总览

| 分类 | 数量 | 占比 |
| --- | ---: | ---: |
| protected（已授权） | 231 | 87.2% |
| public（显式公开） | 21 | 7.9% |
| naked（存量裸端点，已登记） | 13 | 4.9% |
| **合计写端点** | **265** | 100% |

21 个公开写端点经逐一核实均合理；13 个裸端点均不是匿名裸奔（非 `@Public` 必须登录，viewer 写被全局门拦），
但功能授权没有用装饰器表达，而是靠方法体内的认证 / 对象所有权 / 接管锁 / 限流兜底，已登记为 P3 待清挂账。

## 4. 显式公开写端点（21 个，均有合理保护）

| 分组 | 端点 | 保护机制 |
| --- | --- | --- |
| A. 认证/登出 | `admin-auth POST login`、`admin-auth POST logout`、`client-auth POST login` | 登录无法要求已登录；登出幂等 |
| B. 相机/播放器设备通道 | `lpr-webhook POST plate/gio/serial/snap/gate-status/heartbeat`（6）、`playback/player-device POST doc-meta/doc-prepare/heartbeat/advance/progress`（5）、`cameras POST :channel/hls/ensure` | 设备 webhook/心跳/播放进度，无状态设备凭据或无副作用 |
| C. 运营大屏接管 | `park-ops-control POST claim`、`gate-open`、`gate-close` | 现场大屏匿名主控 + `ParkOpsGuard` 接管锁 + `RateLimitGuard` 限流；开/关闸在 service 内校验当前接管者，落审计 |
| D. 本机运维 | `system POST site-heartbeat`、`admin-restart`、`admin-rebuild-frontend` | 后两者双保险：`remoteAddress` 必须为 loopback（127.0.0.1/::1/::ffff:127.0.0.1）且带 token；经 nginx 公网转发后来源 IP 不是 loopback，远程调不通，仅供部署脚本本机调用 |

## 5. 存量裸端点（13 个，P3 待清，只减不增）

这些端点非 `@Public`（必须登录），viewer 写被全局门拦截，但缺装饰器形态的功能授权。按兜底机制分三类：

### A. 自助 / 自身资源（天然安全，可永久豁免）

- `client-auth POST change-password`：`requireActor(req)` 取 actor，`changePassword(actor.userId, oldPassword, newPassword)`，
  只能改自己的密码（userId 来自 token，不接受传入），且需校验旧密码；`RateLimitGuard` 防爆破。
- `media PUT :id`：`media.updateOwned(id, actor, dto)`，service 层对象所有权校验。
- `media DELETE :id`：`media.remove(id, actor)`，service 层对象所有权校验。
- `media POST :id/prepare`：`media.authorized(id, actor, true)`，显式对象授权。
- `media POST :id/access`：`@ReadOnlyRequest()` + `access.issue(req, id, variant)`，只读访问票据，内部授权。

> 这类“只操作自己拥有的资源”无法用粗粒度角色守卫表达，所有权校验本就应在 service 层；
> P3 可在保留所有权校验的同时，给写操作补一个 `media:manage` 功能点以保持模型一致。

### B. 运营大屏接管锁（业务级，claim-based）

- `park-ops-control POST next/prev/goto/auto/release`：service 内 `isOwner(ownerId)` 校验当前接管者，
  非接管者静默忽略（返回当前快照，不执行）；`release` 仅接管者或现场可释放。
- `park-ops-control POST refresh`：强制刷新大屏，service 注释明确“低风险只读操作，不要求接管，现场与远程均可触发”。

> P3 可补 `park-ops:control` 功能点；接管锁逻辑保留。

### C. 仅限流 + 登录（建议 P3 补权限点）

- `cameras POST :channel/hls/start`、`cameras POST :channel/hls/stop`：非 `@Public` 必须登录，
  `RateLimitGuard` 限流，启动/停止 HLS 转码（查看实时视频的辅助）。
  建议 P3 纳入 `camera:view` 权限点。

## 6. 护栏测试：只减不增、防止新增裸端点

`backend/test/naked-write-endpoint-scan.test.cjs`（node:test，随 `pnpm run test:ops` 运行）固化了扫描器，
对两份**人工审计登记清单**做严格相等断言：

- `NAKED_WRITE_ALLOWLIST`（13 项）：存量裸端点挂账；
- `PUBLIC_WRITE_ALLOWLIST`（21 项）：显式公开写端点。

规则：

- 新增一个未登记的裸端点或公开写端点 → 集合多出项，测试失败，提示“补授权守卫，或经安全评审后登记并写明原因”；
- 存量端点补上守卫后，集合少项，测试也失败，提示“从 allowlist 移除”，保证清单随 P3 收敛而不是越积越多。

## 7. 旧守卫与硬编码矩阵清理计划（不在本轮执行，需单独评审）

当前处于规划报告 §7.2 的“**并行 → 替换**”阶段，新旧守卫并存。审计时的存量引用：

| 机制 | 引用规模（非 spec 源文件/用法） |
| --- | --- |
| `@ModuleAccess` / `ModuleAccessGuard` | 22 个文件 / 61 处 |
| `@WriteRoles` / `WriteRolesGuard` | 11 个文件 / 17 处 |
| `@Roles` / `RolesGuard` | 6 个文件 / 8 处 |
| `@RequirePermission` / `PermissionGuard`（新） | 1 个文件 / 5 处（目前仅能源 em123） |

`rbac.ts` 内含两类内容，**必须区别对待**：

- `MODULE_ACCESS` 硬编码模块矩阵（`canWriteModule/canAccessModule/canReadModule` 等）——属功能授权，P3 后随权限点化删除；
- `POWER_DOMAIN` 角色×域矩阵与 `canWritePowerDomain/readablePowerDomains`——属**电源域行级数据授权**，**保留**。

**清理（删除旧装饰器、旧守卫、rbac.ts 功能授权矩阵）必须在以下前置条件全部满足后才进行，且单独评审：**

1. P3（任务 #49）把各模块写端点逐模块替换为 `@RequirePermission`，前端约 49 处按钮/入口完成权限点化；
2. grep 确认 `RolesGuard / WriteRolesGuard / @Roles / @WriteRoles / MODULE_ACCESS` 零引用（计数归零）；
3. **删除旧代码单独评审，经你确认后再做**，删除一律送回收站（不物理删除）；
4. 全程保留 `rbac.ts` 中 `POWER_DOMAIN` 及行级函数，不删除任何数据库/备份/.env。

本轮（P5）只交付扫描护栏与本审计文档，**不删除任何旧守卫、旧装饰器或 rbac.ts 代码**。

## 8. 本轮门禁结果

- 后端 `pnpm exec jest --ci`：119 套件 / 1005 测试全部通过（`frontend-release.spec.ts` 在全量并行时偶发 fs.watch 超时，单跑通过，属已知 flaky，与本次改动无关）。
- 后端 `pnpm run test:ops`：73 项（70 通过 + 3 既有 skip，0 失败），含新增裸端点扫描 3 项。
- 后端 `pnpm run build`（nest build）：通过。
- 仓库根 `node --test tools/ci/*.test.mjs`：8/8 通过。
- 前端门禁（typecheck / 288 测试 / build）在 P4 阶段已全部通过。
