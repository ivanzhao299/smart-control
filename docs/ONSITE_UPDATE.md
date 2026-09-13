# 现场主控机更新流程

> 金湖展贸中心智能控制系统 · 把云端 (cnjinhu.top) 最新代码同步到展厅本地主控机
> 适用于: 已按 [Sprint-01-Windows-部署.md](Sprint-01-Windows-部署.md) 完成首次部署后, 后续日常更新

---

## 0. 架构定位 (理解这一节再操作)

| 节点 | 角色 | MOCK_MODE | 接真实硬件 | 重要性 |
| --- | --- | --- | --- | --- |
| `cnjinhu.top` (云端) | 演示 / 异地查看后台 | **true** | 否 (公网无法访问 192.168.50.x) | 中 |
| 展厅主控机 (GK9000) | **真生产** | **false** | 是 (DALI/LED/HVAC/Audio) | **关键, 命脉** |

**云端 push → GitHub Actions 自动部 cnjinhu.top** (现有流程, 60-90s 完成).
**主控机不会自动跟着更新**, 因为内网在 192.168.50.x, 公网不可达 — 需要手动触发同步.

---

## 1. 三种更新策略

按现场网络情况选:

| 策略 | 现场前提 | 工程师在哪 | 步骤 |
| --- | --- | --- | --- |
| **A. 现场 git pull** | 主控机能联外网 | 现场或远程 | 跑一个脚本完事, **首推** |
| **B. Tailscale 远程推** | 主控机装了 Tailscale | 办公室 | 通过 Tailscale ping 通后, 远程 RDP 或 PowerShell 触发 A 方案 |
| **C. U 盘冷拷贝** | 主控机完全断外网 | 现场 | CI 打 release zip → U 盘拷 → 现场解压重启 |

---

## 2. 策略 A: 现场 git pull (主推)

### 2.1 前提

- 主控机能 ping 通 `github.com` (放行 443 端口)
- 已配置 git 用户的 SSH key 或 HTTPS PAT (用于 clone 时已经配过)
- `scripts\update.ps1` 已存在 (从 commit `4dafa30` 起自带)

### 2.2 一行命令

```powershell
cd D:\smart-control
.\scripts\update.ps1
```

脚本会自动做这些事 (有任何一步失败立即中止):

```
[0/6] 记录当前 commit (用于回滚)
[1/6] 检查工作区干净 (现场不应该有本地改动)
[2/6] 备份: 数据库 + .env + UAT 快照 → backups\YYYYMMDD-HHMMSS\
[3/6] git pull --ff-only origin main
[4/6] 如果 package.json 改了 → 重装依赖
[5/6] npm run build (后端 + 前端)
[6/6] pm2 reload smart-control-backend (零停机)
[+]   健康检查: curl /api/system/health, 状态必须是 ok
```

### 2.3 参数

| 参数 | 作用 |
| --- | --- |
| (无) | 标准流程 |
| `-SkipPull` | 已手动 pull 过, 只重新 build + reload |
| `-Hard` | 用 `pm2 restart` 代替 `reload` (有内存泄漏怀疑时用) |
| `-DryRun` | 只打印会做什么, 不真跑, 用于演练 |
| `-Force` | 即使工作区有本地修改也强行更新 (慎用, 会丢本地改动) |

### 2.4 常见问题

**Q: 卡在 git pull, 提示 conflict?**
A: 现场不应该有本地修改. 排查 `git status`. 如果是构建产物没被 .gitignore 掉, 跑 `git stash` 暂存, 再 pull. 实在不行 → 看 §4 回滚 / 重置.

**Q: pm2 reload 后健康检查 5xx?**
A: 看日志 `pm2 logs smart-control-backend --lines 100`. 数据库 schema 变化时第一次起会做 typeorm 同步, 可能慢, 多等 30s 再 curl. 仍不行 → §4 回滚.

---

## 3. 策略 B: Tailscale 远程触发 (远程维护)

### 3.1 前提

- 主控机装了 Tailscale (按 [Sprint-01 §5.1](Sprint-01-Windows-部署.md) 操作过)
- 工程师笔记本也在同一个 Tailnet 里
- 主控机的 Tailscale IP 已知 (一般是 `100.x.x.x`)

### 3.2 操作

**方法 1: RDP 进去手动跑**
```
工程师笔记本 → mstsc → 100.x.x.x → 登录
打开 PowerShell → cd D:\smart-control → .\scripts\update.ps1
```

**方法 2: PSRemoting 远程触发 (无需 RDP)**
```powershell
# 工程师笔记本上跑
$cred = Get-Credential   # 输入主控机的 Windows 账号
Invoke-Command -ComputerName <主控机Tailscale IP> -Credential $cred -ScriptBlock {
  cd D:\smart-control
  .\scripts\update.ps1
}
```
要求主控机预先开过 `Enable-PSRemoting -Force`.

---

## 4. 策略 C: U 盘冷拷贝 (主控机完全离线)

### 4.1 工程师在公司 (有网)

```bash
# 在干净的开发机上
cd ~/projects/smart-control
git pull origin main
cd backend && pnpm install --frozen-lockfile && npm run build
cd ../frontend && pnpm install --frozen-lockfile && npm run build

# 打包成 zip
cd ..
zip -r smart-control-$(date +%Y%m%d).zip \
  backend/dist backend/package.json backend/package-lock.json backend/node_modules \
  frontend/dist \
  scripts \
  docs

# 拷到 U 盘
cp smart-control-*.zip /Volumes/USB/
```

### 4.2 工程师到现场

1. U 盘插主控机
2. 备份现有: `.\scripts\backup.ps1`
3. 停服务: `pm2 stop smart-control-backend`
4. 备份当前代码: `Rename-Item D:\smart-control D:\smart-control.bak-YYYYMMDD`
5. 解压新版: `Expand-Archive E:\smart-control-*.zip D:\smart-control`
6. 拷回 .env 和数据库:
   ```powershell
   Copy-Item D:\smart-control.bak-YYYYMMDD\backend\.env D:\smart-control\backend\.env
   Copy-Item D:\smart-control.bak-YYYYMMDD\database\smart-control.db D:\smart-control\database\smart-control.db
   ```
7. 启动: `.\scripts\start.ps1`
8. 验证 → 没问题再删 `.bak-YYYYMMDD\`

---

## 5. 失败回滚

### 5.1 update.ps1 在 [3/6] 之后失败

脚本会打印:
```
回滚命令:
  git reset --hard <beforeCommit>
  cd backend && npm run build
  cd .. && cd frontend && npm run build
  pm2 restart smart-control-backend
```
照着粘贴执行即可.

### 5.2 update.ps1 在 [2/6] 之前失败

数据库和 .env 还没被动过, 直接 `pm2 restart smart-control-backend` 看老版本能不能起.

### 5.3 数据库结构出错 (typeorm 同步出意外)

从 backups 还原:
```powershell
pm2 stop smart-control-backend
Copy-Item D:\smart-control\backups\<最新>\smart-control.db D:\smart-control\database\smart-control.db -Force
git reset --hard <出问题前的 commit>
cd backend; npm run build
cd ..\frontend; npm run build
pm2 start smart-control-backend
```

---

## 6. 更新前后核对 (推荐流程)

| 阶段 | 操作 | 期望 |
| --- | --- | --- |
| 更新前 | `pm2 logs --lines 50` | 无 error 堆栈 |
| 更新前 | `curl http://localhost:3000/api/system/health` | `status: ok`, deviceOnline 全 |
| 更新前 | `curl http://localhost:3000/api/devices` | 设备数量与 seed 一致 |
| **更新中** | `.\scripts\update.ps1` | 6/6 全绿, 健康检查 ok |
| 更新后 | 平板手动操作: 灯光一区开关 / 切场景 | 实际硬件响应 |
| 更新后 | 后台→操作日志 | 看到刚才的操作记录 |
| 更新后 | 后台→报警中心 | 无新增 critical |

任何一步异常 → §5 回滚.

---

## 7. 现场更新节奏建议

| 类型 | 频率 | 时间窗 | 流程 |
| --- | --- | --- | --- |
| 小修小补 (UI/文案/小 bug) | 月度 | 闭馆后 19:00-20:00 | 策略 A, 5-10 分钟 |
| 新功能 (新增设备/新场景) | 季度 | 周日上午闭馆日 | 策略 A + 完整 UAT |
| 重大升级 (数据库迁移/换适配器) | 半年 | 提前一周通知 + 备份双份 | 策略 A + 工程师驻场 |
| 紧急 hotfix (严重故障) | 立即 | 任何时间 | 策略 B (Tailscale) 远程修, 或 C (U 盘) 现场修 |

**铁律**:
1. 更新前**一定**先 backup, update.ps1 自动会做, 但要看到 `备份成功` 字样才算数
2. 任何更新不在**展会期间**进行
3. 远程更新 (策略 B) **必须有人在现场配合**, 主控机出问题时能立刻物理触达
4. .env 文件**绝不提交到 git** — 它在 `.gitignore` 里, 现场配置永远只在主控机本地

---

## 8. 相关脚本与文档

| 文件 | 用途 |
| --- | --- |
| `scripts\update.ps1` | 一键更新 (策略 A) |
| `scripts\backup.ps1` | 备份 (update.ps1 会自动调) |
| `scripts\restart.ps1` | 单独重启 (不更新代码) |
| `scripts\logs.ps1` | 查日志 |
| `docs\Sprint-01-Windows-部署.md` | 首次部署完整文档 |
| `docs\DALI_FIELD_INSTALL.md` | DALI 现场施工 |
| `docs\HVAC_FIELD_INSTALL.md` | 空调现场施工 |
| `docs\AUDIO_FIELD_INSTALL.md` | 音响现场施工 |
