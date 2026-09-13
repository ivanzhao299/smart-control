# Sprint-01 交付清单

## 交付内容

| Task | 名称 | 文件 | 状态 |
|------|------|------|------|
| 001 | 初始化 NestJS 项目 | `backend/package.json`, `tsconfig.json`, `.eslintrc.js`, `.prettierrc` | ✅ |
| 002 | 统一目录结构 | `smart-control/{backend,frontend,adapters,database,docs,scripts,logs,deploy}/` | ✅ |
| 003 | SQLite + TypeORM | `backend/src/common/config/typeorm.config.ts`, `database/smart-control.db` | ✅ |
| 004 | 健康检查 API | `backend/src/modules/health/health.controller.ts` → `GET /api/system/health` | ✅ |
| 005 | winston 日志 | `backend/src/common/logger/logger.module.ts` | ✅ |
| 006 | PM2 配置 | `deploy/ecosystem.config.js` | ✅ |
| 007 | Dockerfile | `deploy/Dockerfile` (预留) | ✅ |
| 008 | 环境变量 + README | `backend/.env.example`, `README.md` | ✅ |

## 验收标准

1. `npm install` 无错误
2. `npm run build` 编译通过
3. `npm run start:dev` 启动成功
4. `curl http://localhost:3000/api/system/health` 返回 `{"success":true,"status":"running",...}`
5. `database/smart-control.db` 文件自动生成
6. `logs/app-YYYY-MM-DD.log` 日志正常滚动写入
7. PM2 `pm2 start deploy/ecosystem.config.js` 可正常守护

## 范围边界 (本 Sprint 不做)

- ❌ 灯光 / LED / 音响 / 空调 设备控制
- ❌ 场景联动
- ❌ 前端 UI
- ❌ WebSocket 实时网关
- ❌ 用户鉴权 / RBAC

> 严格按 Sprint 迭代，避免发散开发。
