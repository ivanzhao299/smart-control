# GK9000 自动追主分支

> 让现场主控机自动跟着 GitHub `main` 走, 不用每次推完手动 RDP 进去跑 `update.ps1`.

## 工作原理

```
   开发机 (Mac)              GitHub                       cnjinhu.top (云)
       │                       │                                 │
  git push origin main ───────▶│                                 │
                                │── deploy.yml (60-90s) ─────────▶│ ✓ 上线
                                │
                                │              ┌─ 每 90s 轮询 ──┐
                                │              │                  │
                                └◀── git fetch ┤              GK9000
                                               │              (Windows 10)
                                               └─ 有新 commit ─▶ update.ps1 ▶ pm2 reload
```

GK9000 上一个 Windows 计划任务每 90 秒跑一次 `auto-update-watcher.ps1`:
1. `git fetch origin main` (不动工作区)
2. 对比本地 HEAD vs origin/main
3. 一致 → 静默退出
4. 落后 → 调 `update.ps1` (备份 → pull → build → pm2 reload → 健康检查)

总延迟: CI 60-90s + 轮询 0-90s ≈ **2-3 分钟** 从 push 到现场。

## 一次性安装 (RDP 进 GK9000)

```powershell
# 1. 用管理员 PowerShell 进项目根
cd D:\smart-control

# 2. 先把 watcher + installer 拉下来
git pull origin main

# 3. 注册计划任务 (默认 90s 间隔)
.\scripts\install-auto-update-task.ps1
```

完事。重启 GK9000 也会自动启,不需要 reinstall。

## 验证装好了

```powershell
# 看任务状态
Get-ScheduledTask -TaskName SmartControl-AutoUpdate | Get-ScheduledTaskInfo

# 看日志 (今天的)
Get-Content -Tail 50 D:\smart-control\logs\auto-update-(Get-Date -Format yyyyMMdd).log

# 立即触发一次 (不等 90s)
Start-ScheduledTask -TaskName SmartControl-AutoUpdate
```

## 常用操作

| 场景 | 命令 |
|---|---|
| 改间隔成 60s | `.\scripts\install-auto-update-task.ps1 -IntervalSec 60` (会先卸再装) |
| 临时停掉 | `Disable-ScheduledTask -TaskName SmartControl-AutoUpdate` |
| 临时启用 | `Enable-ScheduledTask -TaskName SmartControl-AutoUpdate` |
| 彻底卸载 | `.\scripts\install-auto-update-task.ps1 -Uninstall` |
| 手动跑一次 (调试) | `.\scripts\auto-update-watcher.ps1 -Verbose` |
| 只看不更新 | `.\scripts\auto-update-watcher.ps1 -DryRun` |

## 拒绝运行的情况

watcher 会**主动跳过**这些情况, 不破坏现场状态:

1. **工作区有未提交改动** — 现场不应该改代码, 看到 `git status` 有内容就拒绝 (加 `-Force` 才覆盖)
2. **上一次还在跑** — `tmp\auto-update.lock` 存在且 < 15 分钟 → 跳过本轮
3. **fetch 失败** — 没网 / GitHub 不通 → 记日志退出, 下一轮重试

## 故障排查

| 症状 | 看哪 |
|---|---|
| 任务一直 `LastTaskResult = 0x41301` | 任务正在运行, 等当前轮跑完 |
| `LastTaskResult` 非 0 | 看 `logs\auto-update-YYYYMMDD.log` 末尾 |
| 跑了但没拉到代码 | 检查 `git remote -v` 是不是指对仓库, `git fetch origin main` 手动跑一遍 |
| update.ps1 半路挂 | 锁文件可能没清, `Remove-Item D:\smart-control\tmp\auto-update.lock` 后下一轮自动恢复 |
| GK9000 启动后不跑 | 用户没登录 (任务是 -AtLogOn 触发), 改成 -AtStartup 或开自动登录 |

## 相关文档

- 单次手动更新: [scripts/update.ps1](../scripts/update.ps1)
- 备份恢复: [HOST_OPERATIONS.md](HOST_OPERATIONS.md)
- 现场维护: [../WINDOWS_MAINTENANCE.md](../WINDOWS_MAINTENANCE.md)
