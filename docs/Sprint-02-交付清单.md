# Sprint-02 交付清单

## 交付目标

完成数据库与基础数据模型，提供设备/场景/日志的 REST API 与初始 Seed。

## 文件清单

### 新增 Entity (`backend/src/entities/`)
- `device.entity.ts` — Device
- `scene.entity.ts` — Scene (含 actions 关联)
- `scene-action.entity.ts` — SceneAction (cascade onDelete)
- `operation-log.entity.ts` — OperationLog
- `user.entity.ts` — User (password select:false)

### 新增模块 (`backend/src/modules/`)
- `devices/` — Controller + Service + DTO (create/update/query)
- `scenes/` — Controller + Service + DTO (含嵌套 SceneActionDto)
- `logs/` — LogsController + OperationLogService (供其他模块写日志)
- `users/` — UsersModule (Entity 暴露，供 Seed)

### 新增工具与配置
- `common/utils/password.util.ts` — scrypt 哈希
- `common/interceptors/response.interceptor.ts` — 改为 Sprint-02 格式 `{success, message, data}`
- `common/filters/all-exceptions.filter.ts` — 错误响应改为 `{success:false, message}`
- `seed/seed.ts` + `seed.module.ts` + `seed.service.ts` — 独立 Seed 命令

### package.json 修改
- 新增依赖：`@nestjs/mapped-types` (PartialType for UpdateDto)
- 新增脚本：`npm run seed` / `npm run seed:dev`

## API 验收

| API | 状态 |
|-----|------|
| GET /api/devices | ✅ 支持 category/status/floor/zone/enabled/keyword/page/pageSize 过滤 |
| GET /api/devices/:id | ✅ 404 当 id 不存在 |
| POST /api/devices | ✅ 验证 + 409 当 name 重复 |
| PUT /api/devices/:id | ✅ 部分字段更新 + 409 当 name 冲突 |
| DELETE /api/devices/:id | ✅ |
| GET /api/scenes | ✅ |
| GET /api/scenes/:id | ✅ eager 加载 actions |
| POST /api/scenes | ✅ 支持嵌套 actions cascade insert |
| PUT /api/scenes/:id | ✅ 传 actions 整体替换 (事务保护) |
| DELETE /api/scenes/:id | ✅ 级联删除 actions |
| GET /api/logs | ✅ 支持 operator/action/targetType/targetId/result/时间区间过滤 |

## Seed 验收

- ✅ admin / admin123 (scrypt 哈希)
- ✅ 6 个场景: opening / reception / meeting / roadshow / cleaning / closing
- ✅ 8 个设备: light_{1f,2f}_main / led_{1f,2f}_main / audio_{1f,2f} / hvac_{1f,2f}
- ✅ 幂等：重复执行跳过已存在记录

## 实测命令

```bash
cd backend
npm install
npm run build
npm run seed          # 初始化
PORT=3300 npm run start:prod  # 启动 (示例端口)
curl http://localhost:3300/api/system/health
curl http://localhost:3300/api/devices
curl http://localhost:3300/api/scenes
curl http://localhost:3300/api/logs
```

## 范围边界 (本 Sprint 不做)

- ❌ 真实设备控制 (DALI/Modbus/TCP 适配)
- ❌ 场景执行引擎
- ❌ WebSocket 实时推送
- ❌ 平板 UI
- ❌ 用户登录鉴权 / JWT / RBAC
- ❌ AI / 云平台 / SaaS

> 严格按 Sprint 迭代。
