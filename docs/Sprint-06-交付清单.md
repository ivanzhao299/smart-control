# Sprint-06 交付清单

## 目标
建立中控后台管理系统：设备 / 场景 / 场景动作 / 定时任务 / 日志中心 / 用户管理 / 系统设置。

## 后端新增

### 实体
- `entities/scheduler-task.entity.ts` — 定时任务表 (含 cron / sceneCode / lastRunAt / lastRunStatus)

### 模块
- `modules/scheduler/` — SchedulerService (CronJob + 应用启动 spawn 已启用任务) + Controller + DTO (Cron 表达式正则校验)
- `modules/scenes/scene-actions.controller.ts` + `scene-actions.service.ts` — 场景动作独立 CRUD
- `modules/users/users.controller.ts` + `users.service.ts` — 用户 CRUD (含 scrypt 密码哈希、默认 admin 不可删)

### 配置
- 新增依赖：`@nestjs/schedule` `cron` `@types/cron`
- `package-lock.json` 已更新

### 新增 API

| Method | Path | 说明 |
|--------|------|------|
| GET    | `/api/users` | 用户列表 |
| GET    | `/api/users/:id` | 用户详情 |
| POST   | `/api/users` | 创建用户 (含密码 scrypt 哈希) |
| PUT    | `/api/users/:id` | 更新用户 (密码留空则不修改) |
| DELETE | `/api/users/:id` | 删除用户 (默认 admin 受保护) |
| GET    | `/api/scheduler` | 定时任务列表 |
| POST   | `/api/scheduler` | 创建任务 (Cron 校验, 启用立即 schedule) |
| PUT    | `/api/scheduler/:id` | 更新任务 (修改 cron/enabled 后自动 respawn) |
| DELETE | `/api/scheduler/:id` | 删除任务 (停止 CronJob) |
| POST   | `/api/scheduler/:id/run` | 立即触发一次 (调试用) |
| GET    | `/api/scenes/:id/actions` | 列出场景的所有动作 (按 sortOrder 排序) |
| POST   | `/api/scenes/:id/actions` | 新增单个动作 |
| PUT    | `/api/scene-actions/:id` | 更新单个动作 |
| DELETE | `/api/scene-actions/:id` | 删除单个动作 |

定时任务执行：使用 `node-cron`(`cron` 包)，时区 `Asia/Shanghai`，触发后调用 `SceneEngineService.execute()`，结果写回 `lastRunAt/lastRunStatus`，同时记入 `operation_logs` (`scheduler.fire`)。

## 前端新增

### 路由 (`router/index.ts`)
- `/admin` — AdminLayout 包裹的子路由
- `/admin/devices`、`/admin/scenes`、`/admin/scenes/:id/actions`、`/admin/scheduler`、`/admin/logs`、`/admin/users`、`/admin/settings`

### Layout
- `layouts/AdminLayout.vue` — 左侧菜单 (6 个入口) + 顶部 (sprint 标签 / mock 标签 / 角色切换 / 时钟) + 主内容区
- 设计与平板 MainLayout 物理隔离，互不影响

### 页面
| 页面 | 路由 | 功能 |
|------|------|------|
| `DevicesAdmin.vue` | `/admin/devices` | 设备列表 + 新增/编辑/删除/启停, 含 IP 格式校验、类别筛选、实时状态显示 |
| `ScenesAdmin.vue` | `/admin/scenes` | 场景 CRUD、测试执行、跳转到动作配置 |
| `SceneActionsAdmin.vue` | `/admin/scenes/:id/actions` | 单场景动作配置：deviceType 联动 command 选项、JSON 参数校验、↑↓ 调序、按 sortOrder 启停 |
| `SchedulerAdmin.vue` | `/admin/scheduler` | 定时任务 CRUD + Cron 预设按钮 + 立即执行 + 最近执行结果 |
| `LogsAdmin.vue` | `/admin/logs` | 日志条件查询：operator/action/targetType/result/时间区间 + 分页 + 长消息 hover JSON 美化 |
| `UsersAdmin.vue` | `/admin/users` | 用户 CRUD + 角色 tag + 密码确认 + admin 保护 |
| `SettingsAdmin.vue` | `/admin/settings` | 中控信息 + 网络配置只读 + 网关健康 + 关键 API 列表 |

### 服务封装 (`services/admin.service.ts`)
- `adminDeviceService` / `adminSceneService` / `adminSceneActionService`
- `adminSchedulerService` / `adminUserService` / `adminLogService`

### Pinia
- `stores/permission.ts` — `usePermissionStore`，角色 admin/operator/viewer，localStorage 持久化，提供 `canEdit / canExecute / canView / canDoAction()`

### 权限策略 (前端基础)
- `admin`：全部操作可见且可用
- `operator`：可执行场景、可立即触发定时任务、不可编辑
- `viewer`：只读
- 角色切换在 AdminLayout 顶部右侧的下拉里

## 表单校验

- 设备：`name` 必填 1-128；`category` 必选；`ip` 必须 IPv4 格式
- 场景：`code` 必填 + `^[a-z0-9_\-]+$i`；`name` 必填
- 场景动作：`deviceId` / `command` 必填；`params` 必须为合法 JSON 对象 (空字符串允许)
- 定时任务：`cron` 必填 + 5/6 段表达式正则；`sceneCode` 必选下拉
- 用户：`username` 2-64；新建 `password` 必填 ≥6 位；编辑允许留空；密码确认必须一致

## 实测验证

### 后端 smoke (本地 :3300)
- ✅ POST /api/users → 创建 op1 operator
- ✅ POST /api/scenes/1/actions → 创建动作 id=1
- ✅ POST /api/scheduler → 创建任务 / 非法 cron 返回 400
- ✅ build 通过

### 公网 (cnjinhu.top, mock 模式, port 3200)
- ✅ `/control/api/system/info` → `Sprint-06 v0.6.0`
- ✅ `/control/api/users` total=1 (admin)
- ✅ `/control/api/scheduler` 创建任务 → 立即 schedule
- ✅ `/control/api/scenes/1/actions` 返回空数组
- ✅ 前端 build 71 文件 / 1268KiB precache
- ✅ admin URL: https://cnjinhu.top/control/#/admin

## 启动 / 测试

### 本地开发
```bash
# 后端
cd backend
npm install
npm run build
npm run seed
npm run start:dev

# 前端 (另一终端)
cd frontend
npm install
npm run dev  # http://localhost:5173/#/admin
```

### 生产 (cnjinhu.top)
- 平板：https://cnjinhu.top/control/
- 后台：https://cnjinhu.top/control/#/admin

## 范围边界 (本 Sprint 不做)
- ❌ AI / 云平台 / SaaS / 多园区 / 数据分析驾驶舱
- ❌ JWT 鉴权后端、密码登录验证 (前端权限纯本地 localStorage)
- ❌ 复杂审批流 / 多级菜单
- ❌ 设备调试器 (Telnet / 串口工具) — Sprint-07 计划

> 严格按 Sprint 迭代。
