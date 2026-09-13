# 金湖科创产业园智慧运营大屏 - 开发规范与三端同步流程

> **版本**: v1.0  
> **更新日期**: 2026-09-12  
> **适用项目**: smart-control (frontend/public/park-ops)

---

## 一、三端定义

| 端 | 说明 | 地址/路径 |
|----|------|-----------|
| **开发端** | 本地开发环境 | `/Users/mac/projects/smart-control` |
| **仓库端** | GitHub 远程仓库 | `ivanzhao299/smart-control` (main分支) |
| **发布端** | GK9000 生产环境 | `D:\smart-control` (Windows 11, PM2) |

---

## 二、三端同步原则

### 2.1 同步方向
```
开发端(本地) → 仓库端(GitHub) → 发布端(GK9000)
```

**禁止反向操作**：不得直接修改生产端文件（会触发部署安全门禁），所有修改必须从开发端提交推送，通过CI/CD自动部署到生产端。

### 2.2 每次开发前必须同步
```bash
cd /Users/mac/projects/smart-control
git fetch origin main
git pull origin main
```
确保本地代码与生产端完全一致后再开始修改。

---

## 三、运营大屏核心文件说明

| 文件 | 类型 | 说明 | 修改注意事项 |
|------|------|------|-------------|
| `index.html` | 源文件 | 页面主结构、顶栏、页面切换、AI数据绑定 | 修改静态资源版本号必须同步更新 |
| `ops-content.mjs` | **源文件** | 业务内容渲染逻辑、页面索引定义 | **必须修改此文件**，不能直接改生成文件 |
| `ops-data-model.mjs` | 源文件 | 业务数据模型、默认数据、占位字段定义 | 修改后必须重新运行build脚本 |
| `ops-content.js` | **生成文件** | 由build-content.cjs合并生成 | **禁止直接修改**，会被CI检测为Stale bundle |
| `build-content.cjs` | 构建脚本 | 合并ops-data-model.mjs + ops-content.mjs | 一般不需要修改 |

### 3.1 关键规则：ops-content.js 生成流程
```
修改 ops-data-model.mjs 或 ops-content.mjs
    ↓
运行: node tools/park-ops/build-content.cjs
    ↓
生成 ops-content.js (自动覆盖)
    ↓
提交所有3个文件 (.mjs源文件 + .js生成文件)
```

**CI构建时会自动运行 `build-content.cjs --check`**，如果检测到ops-content.js与源文件生成结果不一致，会报 `Stale business bundle` 错误，构建失败。

---

## 四、页面索引规范（新增页面后必须更新）

### 4.1 当前页面结构（6页）
| 索引 | 页面名称 | class | 说明 |
|------|----------|-------|------|
| 0 | 欢迎莅临 | `welcome-page` | 首屏欢迎页，大字动画 |
| 1 | 综合态势 | `grid-main` | 首页，左右面板布局 |
| 2 | 企业经营 | `fullgrid` | 三面板布局 |
| 3 | 安全消防 | `fullgrid` | 三面板布局 |
| 4 | 人车管理 | `fullgrid` | 三面板布局，AI分析 |
| 5 | 视频监控 | `fullgrid` | 6路HLS视频 |

### 4.2 ops-content.mjs 中的索引对应
```javascript
pageNodes[1] → 综合态势（左右面板 .left/.right）
pageNodes[2] → 企业经营
pageNodes[3] → 安全消防
pageNodes[4] → 人车管理
pageNodes[5] → 视频监控
```

### 4.3 新增页面后的索引更新检查清单
- [ ] `ops-content.mjs` 中所有 `pageNodes[N]` 索引 +1
- [ ] 重新运行 `build-content.cjs` 生成 `ops-content.js`
- [ ] `index.html` 中静态资源版本号更新
- [ ] PWA端 `PlayerConsole.vue` 中 `totalPages` 字段更新
- [ ] 后端 `park-ops-control.controller.ts` 中 `totalPages` 默认值更新

---

## 五、静态资源版本号规范

### 5.1 为什么需要版本号
生产端浏览器（尤其是LED大屏长时间运行）会强缓存JS/CSS文件。即使服务器端文件已更新，浏览器也可能继续使用缓存的旧版本，导致修复不生效。

### 5.2 版本号格式
```
?v=YYYYMMDD-简短描述
```
示例：`?v=20260912-page-index-fix`

### 5.3 需要更新版本号的场景
- [ ] 修改 `ops-content.mjs` 或 `ops-data-model.mjs` 后（ops-content.js会重新生成）
- [ ] 修改 `park-ops-editor.js` 后
- [ ] 修改 `park-ops-3d.js` 后
- [ ] 修改 `park-ops-editor.css` 后
- [ ] 任何可能影响页面渲染的JS/CSS修改

### 5.4 index.html 中需要同步更新的引用
```html
<link rel="stylesheet" href="./park-ops-editor.css?v=..." />
<script type="module" src="./park-ops-3d.js?v=..."></script>
<script src="./park-ops-editor.js?v=..."></script>
<script src="./ops-content.js?v=..."></script>
```

---

## 六、本地验收流程（推送部署前必须完成）

### 6.1 代码检查
```bash
cd /Users/mac/projects/smart-control

# 1. 检查是否有未提交的修改
git status --short

# 2. 检查ops-content.js是否已重新生成
grep "pageNodes\[" frontend/public/park-ops/ops-content.js

# 3. 检查版本号是否已更新
grep "?v=" frontend/public/park-ops/index.html
```

### 6.2 本地构建验证
```bash
# 重新生成ops-content.js
node tools/park-ops/build-content.cjs

# 前端构建验证（可选，CI会自动构建）
cd frontend && pnpm run build
```

### 6.3 本地预览验证
```bash
# 启动本地开发服务器
cd frontend && pnpm run dev

# 浏览器访问: http://localhost:5173/control/park-ops/index.html
# 逐页检查：
# - 欢迎页大字动画是否正常
# - 综合态势页左右面板内容是否正确
# - 企业经营页三面板内容是否正确
# - 视频监控页6路视频是否正常加载
# - 顶栏KPI数据是否正确，无"占位"字样
```

### 6.4 生产端隧道验证（部署后）
```bash
# 建立SSH隧道
ssh -i ~/.ssh/jinhu_github_actions_deploy -N -L 5174:10.66.66.3:5173 root@123.57.220.65 &

# 浏览器访问: http://localhost:5174/control/park-ops/index.html?verify=<随机数>
# 验证生产端页面效果
```

---

## 七、CI/CD 部署验收标准

### 7.1 双绿原则
**部署成功 = CI ✓ + Deploy ✓ 双绿**

不能只推送就算完成，必须等待两个workflow都成功。

### 7.2 检查命令
```bash
# 查看最近的CI/CD状态
gh run list --limit 5

# 查看某个run的详细日志
gh run view <run_id> --log
```

### 7.3 常见部署失败原因及处理
| 失败原因 | 处理方法 |
|----------|----------|
| `Stale business bundle` | 本地运行 `node tools/park-ops/build-content.cjs` 重新生成ops-content.js，重新提交 |
| `data-source.js 找不到` | Deploy rerun一次，通常是生产端构建时序问题 |
| `frontend/dist/index.html 找不到` | Deploy rerun一次，或检查生产端PM2状态 |
| 生产端页面还是旧的 | 检查index.html中版本号是否更新，现场强制刷新浏览器 |

---

## 八、生产端现场操作规范

### 8.1 强制刷新浏览器
LED大屏浏览器长时间运行后会强缓存，部署后需要：
1. **Ctrl+F5**（Windows）或 **Cmd+Shift+R**（Mac）强制刷新
2. 或直接关闭浏览器重新打开
3. 或在URL后加随机参数：`?nocache=<时间戳>`

### 8.2 不要直接修改生产端文件
- 禁止通过SSH/SCP直接修改 `D:\smart-control` 下的文件
- 禁止直接重启生产端PM2（除非部署脚本自动执行）
- 所有修改必须走CI/CD流程

---

## 九、视频流与AI分析相关规范

### 9.1 录像机配置
| 录像机 | IP | 用户名 | 密码 | 端口 |
|--------|-----|--------|------|------|
| Port5录像机 | 192.168.1.5 | admin | jh666888 (小写j) | 交换机Port5 |
| Port3录像机 | 192.168.1.19 | admin | Jh666888 (大写J) | 交换机Port3 |

### 9.2 6路视频绑定
| 通道 | 名称 | 录像机 | 位置 |
|------|------|--------|------|
| d37 | 北大门 | Port5 | 北大门 |
| d57 | 西大门 | Port5 | 西大门 |
| d02 | 通道2 | Port5 | - |
| p3-d37 | 东大门 | Port3 | 东大门 |
| p3-d45 | 通道45 | Port3 | - |
| p3-d50 | 通道50 | Port3 | - |

### 9.3 AI分析服务
- 服务路径：`D:\video-ai-analyzer\video_ai_analyzer.py`
- API端口：8000
- API：`GET /api/stats`、`GET /api/detections`
- 3个大门同时检测，数据累加计算园区在场/离场

---

## 十、变更记录模板

每次重大变更后，在本文档末尾追加记录：

```
### YYYY-MM-DD 变更标题
- **变更内容**: 简要说明
- **修改文件**: 列出修改的文件
- **影响范围**: 哪些页面/功能受影响
- **验证结果**: 本地验收 + CI/CD + 生产端验证
- **回滚方案**: 如需回滚，如何操作
```

---

## 附录：常用命令速查

```bash
# 同步最新代码
cd /Users/mac/projects/smart-control && git pull origin main

# 重新生成ops-content.js
node tools/park-ops/build-content.cjs

# 提交部署
git add . && git commit -m "描述" && git push

# 查看CI/CD状态
gh run list --limit 5

# 重新触发失败的Deploy
gh run rerun <deploy_run_id>

# 建立生产端SSH隧道
ssh -i ~/.ssh/jinhu_github_actions_deploy -N -L 5174:10.66.66.3:5173 root@123.57.220.65 &

# 生产端访问地址
http://localhost:5174/control/park-ops/index.html
```
