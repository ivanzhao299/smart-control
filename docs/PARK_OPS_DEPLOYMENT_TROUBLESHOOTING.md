# 运营大屏部署与开发问题复盘记录

> 文档创建时间：2026-09-12
> 适用项目：金湖科创产业园智慧运营大屏（park-ops）
> 目的：记录部署和开发过程中遇到的典型问题、根因分析和解决方案，便于后续开发者快速定位和避免重复踩坑。

---

## 一、生产端显示旧版前端问题

### 问题现象
- 生产端LED大屏刷新后仍显示旧版前端（顶栏有"运营数据"按钮，最新版已去掉）
- 多次强制刷新无效，PWA端刷新按钮也无法更新
- 本地开发服务器显示的是最新版，但生产端始终是旧版

### 根因分析
1. **运营大屏页面是独立静态页面**：`park-ops/index.html` 不经过Vue主应用的路由
2. **vite-plugin-pwa只给主应用自动注入Service Worker注册代码**
3. **运营大屏页面没有注册SW**，导致：
   - 主应用的SW预缓存了旧版 `park-ops/index.html`
   - 运营大屏页面无法监听SW的 `controllerchange` 事件
   - 旧缓存永远不会自动更新

### 解决方案
在 `frontend/public/park-ops/index.html` 中添加：
1. **SW注册代码**：
   ```javascript
   if ('serviceWorker' in navigator) {
     navigator.serviceWorker.register('/control/sw.js', { scope: '/control/' });
   }
   ```
2. **SW更新检测逻辑**：
   - 监听 `controllerchange` 事件自动刷新
   - 页面加载/回到前台时主动检查更新
   - 每5分钟定时检查更新
3. **no-cache HTTP头** + **版本号meta标签**

### 相关commit
- `277ffbe`: 添加SW自动更新检测+版本号meta+no-cache头
- `530a9d2`: 添加SW注册代码（之前只有更新检测没有注册）

---

## 二、ops-content.js的panel()函数覆盖静态HTML内容

### 问题现象
- 企业经营页的财务图表、本月营收/利润卡片、光伏发电卡片全部丢失
- 安全消防页的328天安全运行、IoT告警列表、设备在线率卡片丢失
- 人车管理页的人员/车辆类型分布、通行趋势图表丢失
- 视频监控页的人车AI分析卡片（aiAnalysisPanel）丢失
- 所有页面只剩下简单的统计数字和占位文字

### 根因分析
`ops-content.mjs` 中的 `panel()` 函数定义：
```javascript
function panel(node, title, body) {
  node.classList.add('ops-panel');
  node.innerHTML = `<h3>${esc(title)}</h3>${body}`;  // 完全替换！
}
```

这个函数用 `innerHTML` **完全替换**整个panel的内容。在 `render()` 函数中，企业经营页、安全消防页、人车管理页、视频监控页的所有panel都被调用了 `panel()` 函数，导致 `index.html` 中静态定义的丰富内容被 `ops-content.js` 的简单占位内容完全覆盖。

### 受影响的页面和panel

| 页面 | panel | 被覆盖丢失的内容 |
|------|-------|------------------|
| 企业经营(p[0]) | 入驻企业经营态势 | 真实企业名称表格（金湖新材料、希美克门窗等6家） |
| 企业经营(p[1]) | 经营财务趋势 | 财务图表(4-9月营收/支出/利润)、本月营收¥386.5万、本月利润¥151.5万、**光伏发电卡片**(1.4MW/9000度/298吨) |
| 企业经营(p[2]) | 招商与载体 | 招商转化漏斗(线索128→签约36)、企业服务满意度96.8%、各类空间使用率进度条 |
| 安全消防(p[0]) | 消防安全总览 | 328天安全运行零事故、今日巡检完成22/26、隐患整改完成率75%、4类系统在线状态 |
| 安全消防(p[1]) | 智慧设备运行 | IoT/视频/能源/消防4类设备在线率+综合97.6%、1,286/1,318台设备在线 |
| 安全消防(p[2]) | 隐患闭环与IoT告警 | IoT实时告警列表(5条带分级)、隐患闭环表格、开放隐患12项分级、月度安全事件趋势 |
| 人车管理(p[0]) | 人员态势 | 人员类型分布(园区员工/访客/施工)、今日通行趋势柱状图 |
| 人车管理(p[1]) | 车辆态势 | 车辆类型分布(员工/访客/货运)、今日通行趋势、停车资源使用率 |
| 人车管理(p[2]) | 门岗实时事件 | 8条门岗事件列表 |
| 视频监控(p[1]) | 摄像头状态 | **aiAnalysisPanel人车AI分析卡片**（今日人员/车辆通行、车辆细分5类、3个大门详细统计） |

### 解决方案
**注释掉企业经营/安全消防/人车管理页的所有 `panel()` 完全替换调用**，保留 `index.html` 中的丰富静态内容。

后续如需动态绑定数据，应**只更新特定子元素**（如 `.mini2`、`.stat` 等），而非整个 `panel.innerHTML`。

参考视频监控页的修复模式：
```javascript
// 错误：完全替换，会覆盖aiAnalysisPanel
panel(p[1], '摄像头状态', ...);

// 正确：只更新统计数据，保留其他静态内容
const mini2 = cameraPanel.querySelector('.mini2');
if (mini2) {
  mini2.innerHTML = cards(['camerasOnline', 'camerasOffline', 'cameraRate', 'cameraPoints']);
}
```

### 相关commit
- `c35e372`: 修复视频监控页p[1]的panel()覆盖问题
- `b9cb5f0`: 修复企业经营/安全消防/人车管理页的panel()覆盖问题

---

## 三、部署失败导致生产端服务停止

### 问题现象
- CI成功，但Deploy失败
- 生产端后端和前端服务全部被停止（pm2 status显示stopped）
- 生产端完全不可访问

### 根因分析
部署脚本 `scripts/deploy-from-ci.ps1` 的逻辑缺陷：

1. 部署脚本检测到 `"Requested commit is already deployed or superseded"`
2. 只检查**前端bundle**是否存在（`frontend/dist/index.html`、`park-ops/index.html` 等）
3. **没有检查后端dist**（`backend/dist/data-source.js`）
4. 前端bundle存在，所以跳过了完整build流程
5. 直接运行DB迁移，但 `backend/dist/data-source.js` 不存在（可能因之前部署失败被清理）
6. 迁移失败，触发 `MIGRATION_RECOVERY_REQUIRED`
7. 部署脚本执行 `pm2 stop smart-control-backend smart-control-frontend`，停止所有服务
8. 服务停止后不会自动重启，生产端完全不可用

### 部署日志关键信息
```
Requested commit is already deployed or superseded by b9cb5f0...
Reconciling DB migrations (run-migrations.js).
[migrate] 找不到 D:\smart-control\backend\dist\data-source.js — 未build
Deployment failed: [migrate] 找不到...
MIGRATION_RECOVERY_REQUIRED: preserving current code...
> pm2.cmd stop smart-control-backend smart-control-frontend
[PM2] [smart-control-backend](1) stopped
[PM2] [smart-control-frontend](0) stopped
```

### 解决方案
在 `scripts/deploy-from-ci.ps1` 的 `"Reconciling DB migrations"` 步骤前，添加后端dist检查：

```powershell
# Guard: backend dist must exist before running migrations.
$backendDataSource = Join-Path $projectRoot 'backend\dist\data-source.js'
if (-not (Test-Path $backendDataSource)) {
  Write-DeployLog 'Backend dist/data-source.js missing; rebuilding backend before migrations.'
  Invoke-Native 'pnpm.cmd' @('install', '--frozen-lockfile')
  Invoke-Native 'pnpm.cmd' @('run', 'build')
}
```

### 相关commit
- `f7e43d3`: 部署脚本添加后端dist检查，迁移前自动build缺失的后端

---

## 四、开发规范与防坑指南

### 4.1 运营大屏页面开发规范

#### 文件结构
- **源文件（必须修改）**：`frontend/public/park-ops/ops-content.mjs`
- **生成文件（不要直接修改）**：`frontend/public/park-ops/ops-content.js`
- **构建命令**：`node tools/park-ops/build-content.cjs`
- **CI检查**：构建时会执行 `build-content.cjs --check`，检测源文件和生成文件不一致会报 `Stale business bundle`

#### panel()函数使用禁忌
- **禁止**用 `panel()` 完全替换包含丰富静态内容的panel
- **必须**只更新需要动态绑定的特定子元素（如 `.mini2`、`.stat`）
- 添加新的丰富内容时，**优先写在 `index.html` 中**，不要写在 `ops-content.mjs` 的 `panel()` 调用里

#### Service Worker相关
- 运营大屏是独立静态页面，**必须手动注册SW**
- 修改运营大屏内容后，**必须更新版本号meta**，确保SW能检测到更新
- 生产端验证时，**必须通过PWA端的强制刷新按钮**触发SW更新，普通刷新可能无效

### 4.2 部署规范

#### 三端同步流程
1. **本地开发**：修改代码 → 本地构建 → 本地验证（localhost:5173）
2. **推送仓库**：git commit + git push → 等待CI成功
3. **部署生产**：等待Deploy成功 → 通过SSH隧道验证生产端（localhost:5174）
4. **现场验证**：通过PWA端强制刷新LED大屏 → 现场确认效果

#### 部署成功判定标准
- **必须CI✓ + Deploy✓双绿**才算部署成功
- 不能只推送代码就算完成
- Deploy失败时，**必须立即排查并恢复生产端服务**
- 部署失败可能导致生产端服务被停止，需要手动恢复

#### 生产端服务恢复
如果部署失败导致服务停止：
1. 检查部署日志，定位失败原因
2. 修复问题并推送新commit，触发完整部署流程
3. 新commit会执行完整build（包括后端），从而恢复服务
4. 部署成功后，通过PWA端强制刷新LED大屏

### 4.3 常见问题快速排查

| 问题现象 | 可能原因 | 排查方向 |
|----------|----------|----------|
| 生产端显示旧版 | SW缓存未更新 | 检查index.html是否有SW注册代码，通过PWA强制刷新 |
| 页面卡片内容丢失 | panel()覆盖了静态HTML | 检查ops-content.mjs中是否有panel()调用，注释掉保留静态内容 |
| 生产端无法访问 | 部署失败服务被停止 | 检查CI/CD状态，查看Deploy日志，推送新commit触发完整部署 |
| 本地正常生产异常 | 构建产物不一致 | 运行 `node tools/park-ops/build-content.cjs` 重新生成ops-content.js |
| 视频流不显示 | FFmpeg进程未运行 | 检查生产端FFmpeg进程数量（正常应为12个），重启转码服务 |
| AI分析数据为0 | AI分析服务未运行 | 检查生产端 `D:\video-ai-analyzer\video_ai_analyzer.py` 是否在运行，端口8000 |

---

## 五、关键配置信息

### 项目路径
- 项目根路径：`/Users/mac/projects/smart-control`
- GitHub仓库：`ivanzhao299/smart-control`

### 生产端（GK9000）
- 系统：Windows 11
- 项目路径：`D:\smart-control`
- 前端PM2端口：5173
- 后端PM2端口：3200
- AI分析服务：`D:\video-ai-analyzer\video_ai_analyzer.py`，端口8000

### 网络配置
- SSH跳板机：`root@123.57.220.65`，密钥 `~/.ssh/jinhu_github_actions_deploy`
- 生产端SSH：`user@10.66.66.3`，通过跳板机ProxyCommand连接
- 本地验证隧道：`ssh -i ~/.ssh/jinhu_github_actions_deploy -N -L 5174:10.66.66.3:5173 root@123.57.220.65`

### 视频流配置
- Port5录像机：IP `192.168.1.5`；凭据由 SQLite `video.binding` 配置保存，文档禁止记录明文
- Port3录像机：IP `192.168.1.19`；凭据由 SQLite `video.binding` 配置保存，文档禁止记录明文
- 6路视频绑定：d37（北大门）、d57（西大门）、d02、p3-d37（东大门）、p3-d45、p3-d50
- 摄像头总数：2台64路NVR共128路，125在线3离线，在线率97.7%

### 页面结构（6页+欢迎页）
- pageNodes[0] = 欢迎莅临（welcome-page）
- pageNodes[1] = 综合态势（grid-main，首页，含4路视频安防）
- pageNodes[2] = 企业经营（fullgrid，3个panel）
- pageNodes[3] = 安全消防（fullgrid，3个panel）
- pageNodes[4] = 人车管理（fullgrid，3个panel）
- pageNodes[5] = 视频监控（fullgrid，6路HLS视频墙+摄像头状态+aiAnalysisPanel）

---

## 六、相关commit历史

| commit | 说明 |
|--------|------|
| `f7e43d3` | fix: 部署脚本添加后端dist检查，迁移前自动build缺失的后端 |
| `b9cb5f0` | fix: 修复ops-content.js用panel()完全替换导致企业经营/安全消防/人车管理页丰富卡片丢失 |
| `c35e372` | fix: 修复ops-content.js用panel()完全替换摄像头状态panel导致AI分析卡片被覆盖 |
| `530a9d2` | fix: 运营大屏添加Service Worker注册代码（之前只有更新检测没有注册） |
| `277ffbe` | fix: 运营大屏添加Service Worker自动更新检测+版本号meta+no-cache头 |
| `9f5cabc` | fix: 修复后端编译错误 - 缺少Query装饰器导入（CI/Deploy双绿） |
| `3dd2444` | feat: 运营大屏UI全面优化 + 修复刷新按钮重复刷新问题（CI失败，Query未导入） |

---

## 七、后续改进建议

1. **ops-content.mjs重构**：将 `panel()` 函数改为支持增量更新，避免完全替换innerHTML
2. **部署脚本增强**：添加部署失败后的自动服务恢复机制，避免服务停止后需要手动干预
3. **SW更新机制优化**：添加部署完成后的自动SW更新通知，确保生产端能及时获取最新版本
4. **CI/CD监控告警**：部署失败时立即发送告警，避免生产端服务长时间不可用
5. **本地-生产一致性检查**：部署前自动对比本地和生产端的关键文件，确保一致性

---

*本文档持续更新，遇到新问题请及时补充记录。*
