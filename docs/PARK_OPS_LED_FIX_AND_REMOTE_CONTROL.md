# 运营大屏LED亮线修复 & 远程翻页控制 — 技术文档

> **日期**: 2026-09-11
> **版本**: v1.0
> **涉及模块**: 前端运营大屏(park-ops)、前端PlayerConsole组件、后端CamerasModule
> **部署环境**: GK9000 生产端 (Windows 10 Pro)

---

## 一、更改概述

本次完成两项优化：

1. **LED大屏亮线修复** — 解决运营大屏在LED现场显示时边缘出现一圈亮线的问题
2. **运营大屏远程翻页控制** — 在PWA播放控制卡片上添加运营大屏翻页/自动轮播按钮，实现从控制端远程控制LED大屏端运营大屏翻页

---

## 二、LED大屏亮线修复

### 2.1 问题现象

运营大屏在LED大屏现场显示时，屏幕边缘出现一圈亮线（蓝色光晕），之前点对点显示时没有此问题。

### 2.2 根因分析

`frontend/public/park-ops/index.html` 中 body 的背景样式使用了**径向渐变**：

```css
body {
  background: radial-gradient(1200px 650px at 50% 45%, rgba(20,84,125,.22), transparent 70%),
              linear-gradient(180deg, #071828 0%, #04101b 60%, #020914 100%);
}
```

当 `#app` 容器（3612×1462）通过 `transform: scale()` 缩放到LED大屏分辨率时，边缘会出现**亚像素缝隙**（sub-pixel gap）。此时 body 的径向渐变背景（中心蓝色 `rgba(20,84,125,.22)`）就会从缝隙中透出，在屏幕边缘形成一圈蓝色亮线。

### 2.3 修复方案

将 body 背景从径向渐变改为**纯深色**，消除边缘亮色透出：

```css
body {
  background: #020914;
}
```

### 2.4 涉及文件

| 文件 | 修改内容 |
|------|----------|
| `frontend/public/park-ops/index.html` | body 背景从径向渐变改为纯深色 `#020914` |

### 2.5 验证方法

1. 通过SSH隧道访问运营大屏：`http://localhost:5174/control/park-ops/`
2. 打开浏览器开发者工具，检查 `body` 的 `background-color` 应为 `rgb(2, 9, 20)`
3. LED现场观察：边缘亮线应消失

---

## 三、运营大屏远程翻页控制

### 3.1 需求背景

PWA端（平板/手机）投放园区运营大屏画面时，播放界面看不见实际画面，只有操作按钮。需要在播放控制卡片上添加翻页/自动轮播按钮，远程控制LED大屏端的运营大屏翻页。

### 3.2 架构设计

```
┌─────────────────┐     HTTP POST      ┌─────────────────┐
│  PWA控制端       │ ──────────────────> │  后端 API       │
│  PlayerConsole   │                      │  ParkOpsControl │
│  (翻页按钮)      │ <────────────────── │  Controller     │
└─────────────────┘     JSON响应         └────────┬────────┘
                                                    │
                                           写入 JSON 文件
                                           (data/park-ops-control.json)
                                                    │
┌─────────────────┐     HTTP GET 500ms轮询         │
│  LED大屏端       │ <──────────────────────────────┘
│  运营大屏        │
│  (park-ops)      │
│  执行翻页/自动轮播│
└─────────────────┘
```

**通信方式**: HTTP API + 运营大屏端 500ms 短轮询
**后续优化方向**: 可改为 WebSocket 推送，降低延迟

### 3.3 后端实现

#### 3.3.1 文件位置

`backend/src/modules/cameras/park-ops-control.controller.ts`

#### 3.3.2 数据存储

使用 JSON 文件存储当前状态：
- 路径: `data/park-ops-control.json`（由 `DATA_DIR` 环境变量决定，默认 `process.cwd()/data`）
- 内容: `{ "page": 0, "autoPlay": false, "timestamp": 1789118632974 }`

#### 3.3.3 API 文档

所有接口均添加 `@Public()` 装饰器，**无需登录认证**（运营大屏是独立静态页面，无登录态）。

| 方法 | 路径 | 说明 | 请求体 | 响应 |
|------|------|------|--------|------|
| GET | `/api/park-ops-control/state` | 获取当前状态 | - | `{ success, data: { page, autoPlay, timestamp } }` |
| POST | `/api/park-ops-control/next` | 下一页（循环） | - | `{ success, message, data }` |
| POST | `/api/park-ops-control/prev` | 上一页（循环） | - | `{ success, message, data }` |
| POST | `/api/park-ops-control/goto` | 跳转到指定页 | `{ page: number }` (0-4) | `{ success, message, data }` |
| POST | `/api/park-ops-control/auto` | 切换自动轮播 | `{ enabled?: boolean }` 不传则切换 | `{ success, message, data }` |

**页码范围**: 0-4（运营大屏共5页）
- 0: 综合态势
- 1: 企业经营
- 2: 安防监控
- 3: 能耗管理
- 4: 人车管理

#### 3.3.4 模块注册

在 `backend/src/modules/cameras/cameras.module.ts` 中注册：

```typescript
import { ParkOpsControlController } from './park-ops-control.controller';

@Module({
  controllers: [CamerasController, VideoBindingController, ParkOpsControlController],
  // ...
})
```

### 3.4 运营大屏端实现

#### 3.4.1 文件位置

`frontend/public/park-ops/index.html`

#### 3.4.2 轮询逻辑

在 `render()` 之后添加远程控制轮询模块：

```javascript
(function initRemoteControl(){
  let lastPage = idx;
  let lastAuto = !!timer;
  async function poll(){
    try{
      const r = await fetch('/api/park-ops-control/state',{cache:'no-store'});
      const j = await r.json();
      if(!j.success||!j.data)return;
      const {page, autoPlay} = j.data;
      if(page !== lastPage){ lastPage = page; go(page); }
      if(autoPlay !== lastAuto){
        lastAuto = autoPlay;
        // 开启/关闭自动轮播定时器
      }
    }catch(e){/* 网络异常时静默, 不影响本地操作 */}
  }
  setInterval(poll, 500);
})();
```

**关键设计**:
- 轮询间隔: 500ms（平衡响应速度和服务器负载）
- 本地操作优先: 轮询只在远程状态变化时触发，本地手动翻页不受影响
- 异常静默: 网络异常时不报错，不影响运营大屏正常运行

### 3.5 PWA播放控制卡片实现

#### 3.5.1 文件位置

`frontend/src/components/PlayerConsole.vue`

#### 3.5.2 状态与函数

```typescript
const parkOpsPage = ref(0);        // 当前页码
const parkOpsAuto = ref(false);     // 自动轮播状态
const parkOpsBusy = ref(false);     // 请求中防重复点击

async function parkOpsControl(action: 'next' | 'prev' | 'auto'): Promise<void>
async function syncParkOpsState(): Promise<void>  // 投放后同步当前状态
```

#### 3.5.3 模板

在 `doc-pager`（文档翻页条）之后添加运营大屏翻页控制条，使用 `v-if="activeSource === 'park-dashboard'"` 条件显示：

```html
<div v-if="activeSource === 'park-dashboard'" class="doc-pager park-ops-pager">
  <span class="pg-label">运营大屏控制</span>
  <button class="pg-btn big" :disabled="parkOpsBusy" @click="parkOpsControl('prev')">
    <ChevronLeft :size="20" /> 上一页
  </button>
  <span class="pg-num v2-inter">{{ parkOpsPage + 1 }}<i>/ 5</i></span>
  <button class="pg-btn big" :disabled="parkOpsBusy" @click="parkOpsControl('next')">
    下一页 <ChevronRight :size="20" />
  </button>
  <span class="pg-gap"></span>
  <button class="pg-btn" :class="{ on: parkOpsAuto }" :disabled="parkOpsBusy" @click="parkOpsControl('auto')">
    <RefreshCw :size="15" /> {{ parkOpsAuto ? '自动轮播：开' : '自动轮播：关' }}
  </button>
</div>
```

#### 3.5.4 样式

```css
.park-ops-pager {
  background: linear-gradient(135deg, rgba(18,91,126,.15), var(--v2-surf-1));
  border-color: rgba(99,217,255,.3);
}
.park-ops-pager .pg-btn.on {
  background: var(--v2-primary);
  color: var(--v2-on-primary);
  border-color: var(--v2-primary);
}
.pg-label {
  font-size: 14px;
  font-weight: 700;
  color: var(--v2-primary);
  margin-right: 4px;
  white-space: nowrap;
}
```

#### 3.5.5 触发时机

在 `selectParkDashboard()` 函数成功投放运营大屏后，调用 `syncParkOpsState()` 同步当前页码和自动轮播状态，确保控制卡片显示准确。

### 3.6 涉及文件清单

| 层级 | 文件 | 修改类型 |
|------|------|----------|
| 后端 | `backend/src/modules/cameras/park-ops-control.controller.ts` | 新建 |
| 后端 | `backend/src/modules/cameras/cameras.module.ts` | 修改（注册Controller） |
| 运营大屏 | `frontend/public/park-ops/index.html` | 修改（body背景+轮询逻辑） |
| PWA前端 | `frontend/src/components/PlayerConsole.vue` | 修改（翻页控制条+状态函数+样式+图标导入） |

---

## 四、部署情况

### 4.1 生产环境信息

| 项目 | 值 |
|------|-----|
| 服务器 | GK9000 (Windows 10 Pro) |
| 项目路径 | `D:\smart-control` |
| 后端端口 | 3200 |
| 前端端口 | 5173 |
| 进程管理 | PM2 |
| Node.js | v20.18.0 |
| FFmpeg | `D:\smart-control-tools\ffmpeg\bin\ffmpeg.exe` (v8.1.2) |

### 4.2 PM2 进程

```
┌────┬───────────────────────────┬─────────┬──────────┐
│ id │ name                      │ status  │ 端口     │
├────┼───────────────────────────┼─────────┼──────────┤
│ 0  │ smart-control-backend     │ online  │ 3200     │
│ 1  │ smart-control-frontend    │ online  │ 5173     │
└────┴───────────────────────────┴─────────┴──────────┘
```

### 4.3 SSH 访问方式

通过跳板机嵌套SSH访问GK9000：

```
本地 → 跳板机 root@123.57.220.65 → GK9000 user@10.66.66.3
```

**密钥文件**:
- 本地→跳板机: `~/.ssh/jinhu_github_actions_deploy`
- 跳板机→GK9000: `/root/.ssh/anksen-gk9000-deploy`

**SSH隧道验证**（本地5174→GK9000:5173）:
```bash
ssh -i ~/.ssh/jinhu_github_actions_deploy -N -L 5174:10.66.66.3:5173 root@123.57.220.65
# 访问 http://localhost:5174/control/park-ops/
```

### 4.4 部署脚本

项目根目录提供两个部署脚本：

| 脚本 | 用途 |
|------|------|
| `deploy-gk9000.ps1` | 完整部署（git pull + 后端构建 + 前端构建 + PM2重启） |
| `deploy-backend-only.ps1` | 仅后端部署（git pull + 后端构建 + 后端PM2重启） |

### 4.5 部署步骤（推荐方式）

由于嵌套SSH中引号转义极易出错，推荐使用**脚本文件方式**部署：

```bash
# 1. 本地写好 .ps1 脚本
# 2. 上传到跳板机
scp -i ~/.ssh/jinhu_github_actions_deploy deploy.ps1 root@123.57.220.65:/tmp/
# 3. 跳板机上传到GK9000
ssh -i ~/.ssh/jinhu_github_actions_deploy root@123.57.220.65 \
  "scp -i /root/.ssh/anksen-gk9000-deploy /tmp/deploy.ps1 'user@10.66.66.3:C:/Users/user/deploy.ps1'"
# 4. GK9000执行
ssh -i ~/.ssh/jinhu_github_actions_deploy root@123.57.220.65 \
  "ssh -i /root/.ssh/anksen-gk9000-deploy user@10.66.66.3 'powershell -ExecutionPolicy Bypass -File C:\Users\user\deploy.ps1'"
```

### 4.6 部署注意事项

1. **后端增量构建问题**: 后端增量构建会导致文件缺失（`Cannot find module './common/config/configuration'`），部署时必须先删除 `dist` 目录再完整重新构建
2. **PWA强缓存**: 前端更新后需清除Service Worker、Cache Storage、IndexedDB，或在URL加随机参数（如 `?_t=时间戳`）绕过缓存
3. **PowerShell语法**: Windows PowerShell不支持 `&&` 语法，需用分号 `;` 或脚本文件
4. **Windows路径**: scp到Windows时路径格式为 `C:/Users/user/file.ps1`（正斜杠），不是 `/c/Users/user/`

---

## 五、换电脑开发指南

### 5.1 环境要求

| 工具 | 版本要求 |
|------|----------|
| Node.js | >= 18.x (推荐 v20.x) |
| npm | 随Node.js安装 |
| Git | 任意版本 |
| SSH客户端 | 系统自带（macOS/Linux）或 Git Bash（Windows） |

### 5.2 代码获取

```bash
git clone git@github.com:ivanzhao299/smart-control.git
cd smart-control
```

### 5.3 依赖安装

```bash
# 后端
cd backend
npm install

# 前端
cd ../frontend
npm install
```

### 5.4 SSH密钥配置

从原电脑复制以下密钥文件到新电脑的 `~/.ssh/` 目录：

| 密钥文件 | 用途 | 权限 |
|----------|------|------|
| `jinhu_github_actions_deploy` | 本地→跳板机 | 600 |
| `anksen-gk9000-deploy` | 跳板机→GK9000（放在跳板机上） | 600 |

```bash
# 设置权限
chmod 600 ~/.ssh/jinhu_github_actions_deploy
```

### 5.5 本地开发启动

```bash
# 后端 (端口3000)
cd backend
npm run start:dev

# 前端 (端口5173)
cd frontend
npm run dev
```

**本地访问**:
- 前端: `http://localhost:5173/control/`
- 运营大屏: `http://localhost:5173/control/park-ops/`
- 后台管理: `http://localhost:5173/control/admin/`
- 客户端登录密码: `1234`
- 后台admin密码: `jinhu888`

### 5.6 构建验证

```bash
# 后端构建
cd backend && npm run build

# 前端构建
cd frontend && npm run build
```

### 5.7 部署到生产端

参考本文档 **4.5 部署步骤**，使用脚本文件方式部署到GK9000。

---

## 六、验证清单

### 6.1 LED亮线修复验证

- [ ] 访问运营大屏，检查body背景色为 `rgb(2, 9, 20)`
- [ ] LED现场观察，边缘无亮线
- [ ] 页面内容显示正常，无其他样式异常

### 6.2 远程翻页控制验证

- [ ] API测试: `GET /api/park-ops-control/state` 返回 `{ success: true, data: {...} }`
- [ ] API测试: `POST /api/park-ops-control/next` 页码+1
- [ ] API测试: `POST /api/park-ops-control/prev` 页码-1
- [ ] API测试: `POST /api/park-ops-control/auto` 切换自动轮播
- [ ] 运营大屏端: 发送远程命令后500ms内执行翻页
- [ ] PWA控制卡片: 投放运营大屏后显示翻页控制条
- [ ] PWA控制卡片: 点击上一页/下一页按钮，LED大屏端运营大屏同步翻页
- [ ] PWA控制卡片: 点击自动轮播按钮，LED大屏端运营大屏开启/关闭自动轮播
- [ ] 本地操作优先: 运营大屏本地手动翻页不受远程轮询影响

---

## 七、相关文档链接

- [HANDOVER.md](./HANDOVER.md) — 项目交接总文档
- [GK9000_FIELD_SETUP.md](./GK9000_FIELD_SETUP.md) — GK9000现场设置指南
- [PARK_OPS_DASHBOARD_DEMO.md](./PARK_OPS_DASHBOARD_DEMO.md) — 运营大屏演示文档
- [SURVEILLANCE_EQUIPMENT.md](./SURVEILLANCE_EQUIPMENT.md) — 监控设备清单
- [CI_CD.md](./CI_CD.md) — CI/CD流水线文档
- [PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) — 生产部署检查清单

---

## 八、变更记录

| 日期 | 版本 | 变更内容 | 作者 |
|------|------|----------|------|
| 2026-09-11 | v1.0 | 初始版本：LED亮线修复 + 远程翻页控制 | AI Assistant |
