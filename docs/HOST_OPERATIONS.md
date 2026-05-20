# GK9000 中控主机 日常运维手册

> 金湖展贸中心智能控制系统 · 占美 GIADA GK9000 工控机
> **这是日常运维的总入口**, 各专项细节见 §6 文档地图

---

## 0. 你需要先知道这些

| 项 | 值 |
| --- | --- |
| 主机型号 | 占美 GIADA GK9000 (i7-10750H / 16G / 1TB SSD) |
| 操作系统 | Windows 10 专业版 |
| 部署根目录 | `D:\smart-control\` |
| 设备网 IP | `192.168.50.10` (NIC1, 接弱电交换机) |
| 管理网 IP | DHCP (NIC2, 接公司 LAN) |
| Tailscale IP | `100.x.x.x` (装完 Tailscale 后查看) |
| 后端端口 | `3000` |
| 平板入口 | `http://192.168.50.10/control/` |
| 后台入口 | `http://192.168.50.10/control/#/admin` |
| 默认账号 | `admin` / `admin123` (**首次登录后必须改密**) |

---

## 1. 三种接入主机的方式

按你人在哪选:

### 1.1 现场 + 显示器键鼠 (物理接入)

直接在主机前操作, 桌面就是 Windows 10. 适用:
- 首次部署 / 重装系统
- 重大故障 (系统 hang / 网络全断)
- 工程师驻场调试

### 1.2 现场 + 平板/手机/笔记本 (局域网浏览器)

**这是 90% 的日常方式**.

打开浏览器, 访问:
- 业务操作: `http://192.168.50.10/control/`
- 管理后台: `http://192.168.50.10/control/#/admin`

平板/电脑都能用, 推荐用 1920×1200 安卓平板 (已专门适配).

### 1.3 外地远程 (Tailscale)

笔记本 / iPad 装 [Tailscale](https://tailscale.com/), 用公司账号加入 Tailnet, 然后:

| 用途 | 路径 |
| --- | --- |
| 浏览器访问后台 (推荐, 跟现场一样) | `http://<主机 Tailscale IP>/control/#/admin` |
| RDP 远程桌面 (要跑 PowerShell 时) | `Win+R → mstsc → <主机 Tailscale IP>` |

---

## 2. 三层管理

### 2.1 第 1 层: Web 后台 (你 90% 的时间在这)

**业务操作** (平板控制台 `/control/`):

| 页面 | 干什么 |
| --- | --- |
| 总览 | 一键场景 (开馆 / 接待 / 会议 / 路演 / 清洁 / 闭馆) |
| 灯光 | 12 个区域分开 / 总控 / 调亮度 |
| LED 大屏 | 开屏 / 关屏 / 切输入源 / 播视频 |
| 音响 | 4 区音量 / 静音 / 切音源 |
| 空调 | 10 台内机分开 / 模式 / 温度 / 风速 |

**管理配置** (后台 `/admin/`):

| 菜单 | 干什么 |
| --- | --- |
| 首页 Dashboard | 实时设备在线数 / CPU / 内存 / uptime / 最近报警 |
| 场景管理 | 改 6 个场景包含的动作清单 |
| 场景执行记录 | 看每次执行耗时 + 成功/失败明细 |
| 设备管理 | 加设备 / 改 IP / 启停 / 单台测试 |
| 硬件清单 | 13 类物理资产 (网关/转换器/调光器/控制器...) |
| 用户管理 | 加/删工作人员, 改密码, 调权限 |
| 定时任务 | cron 配 "工作日 9:00 自动开馆" |
| 报警中心 | 设备掉线 / 场景失败的告警, 处理/忽略 |
| 操作日志 | 谁、什么时候、点了什么按钮、成功/失败 |
| UAT 验收 | 16 项现场验收 checklist |
| 测试中心 | 单设备 / 单子系统 / 单场景拨测 (不影响生产) |
| 系统设置 | MOCK_MODE 切换等系统参数 |

> **改完即时生效**, 不需要重启服务.

### 2.2 第 2 层: PowerShell 脚本 (周/月级别用)

接显示器或 RDP 进主机, 打开 PowerShell (建议管理员):

```powershell
cd D:\smart-control
```

| 命令 | 干什么 | 频率 |
| --- | --- | --- |
| `.\scripts\start.ps1` | 启动 (首次或重装后) | 极少 |
| `.\scripts\stop.ps1` | 停止 | 极少 |
| `.\scripts\restart.ps1` | 平滑重启 (零停机) | 月 1 次 |
| `.\scripts\restart.ps1 -Hard` | 强制重启 | 出 bug 时 |
| `.\scripts\restart.ps1 -Build` | 重新编译后重启 | 改 .env 后 |
| `.\scripts\logs.ps1` | 实时跟随日志 (Ctrl+C 退出) | 排错时 |
| `.\scripts\logs.ps1 -Err` | 只看错误日志 | 排错时 |
| `.\scripts\logs.ps1 -Tail 200` | 看最近 200 行 | 排错时 |
| `.\scripts\backup.ps1` | 手动备份 (数据库 + .env + UAT) | 重大变更前 |
| `.\scripts\update.ps1` | 同步云端最新代码 | 月 1 次 |
| `pm2 list` | 看后台进程状态 | 排错时 |
| `pm2 monit` | 实时 CPU/内存监控仪表盘 | 排错时 |

**铁律**: 这些命令不破坏数据, 出问题优先 `restart.ps1`, 实在不行再 `update.ps1` 同步或回滚.

### 2.3 第 3 层: 文件 + Windows 系统 (基本不碰)

| 改什么 | 在哪改 | 改完要做什么 |
| --- | --- | --- |
| 后端端口 / 数据库路径 / MOCK_MODE / 设备 IP | `D:\smart-control\backend\.env` | `.\scripts\restart.ps1 -Build` |
| Nginx 反代 / SSL | `D:\smart-control\deploy\nginx\` | Nginx 重启 |
| 网卡 IP / 防火墙 / Tailscale | Windows 设置 / 控制面板 | 偶尔重启网络 |
| 时区 / 自动登录 / Update | Windows 设置 | 偶尔需重启系统 |
| 添加新设备 (硬件接线) | 物理接, 然后后台 → 设备管理 → 新增 | 后台改完即时生效 |

⚠ **.env 是敏感配置, 千万不要提交到 git**. 它在 `.gitignore` 里, 只在主控机本地.

---

## 3. 常见操作场景

### 3.1 业务操作 (天天做)

| 我要... | 怎么做 |
| --- | --- |
| 立即开馆 | 平板 → 总览 → 点 "开馆模式" |
| 开/关某一区灯 | 平板 → 灯光 → 点对应区域按钮 |
| 调灯光亮度 | 平板 → 灯光 → 拖滑条 |
| 切空调模式 | 平板 → 空调 → 选对应内机 → 改模式/温度 |
| LED 播放视频 | 平板 → LED → 选预设/输入源 |

### 3.2 配置管理 (周/月做)

| 我要... | 怎么做 |
| --- | --- |
| 改 "开馆模式" 包含的动作 | `/admin/#/scenes` → 选 "开馆模式" → 编辑动作 → 保存 |
| 新增一个工作人员账号 | `/admin/#/users` → 新建 → 设密码 + 权限 (admin/operator/viewer) |
| 配定时自动开馆 | `/admin/#/scheduler` → 新建 → cron `0 9 * * 1-5` (工作日 9 点) → 关联 "开馆模式" |
| 改某设备的 IP | `/admin/#/devices` → 选设备 → 改 ip 字段 → 保存 (即时生效) |
| 添加新场景 (比如 "VIP 接待") | `/admin/#/scenes` → 新建 → 配动作 |
| 改首页 LOGO / 标题 | 代码改, 走 git pull → update.ps1 |

### 3.3 监控状态 (天天看)

| 我要看... | 在哪看 |
| --- | --- |
| 现在系统有没有故障 | `/admin/` 首页 (顶部状态条 + 报警条数) |
| 今天所有操作记录 | `/admin/#/operation-logs` |
| 上次某场景执行的明细 | `/admin/#/scene-executions` |
| 某设备最近的健康状态 | `/admin/#/devices` → 点对应设备 |
| 系统资源 (CPU / 内存) | `/admin/` 首页 / 或 PowerShell 跑 `pm2 monit` |
| 后端实时日志 (技术细节) | RDP 进主机 → `.\scripts\logs.ps1` |

### 3.4 故障处理

| 现象 | 怎么办 |
| --- | --- |
| 平板打不开 `/control/` | 1) 主机断电了? 看亮灯 2) 网络断了? `ping 192.168.50.10` 3) 服务挂了? RDP 进去 `.\scripts\restart.ps1 -Hard` |
| 某设备一直离线 | `/admin/#/devices` 看设备状态; 现场看网关供电 / 网线; ping 网关 IP 测试 |
| 场景执行总有一两步失败 | `/admin/#/scene-executions` 查看失败详情 → 看是哪个设备 → 单独到 `/admin/#/test-center` 拨测 |
| 后端起不来 (pm2 显示 errored) | 看日志: `.\scripts\logs.ps1 -Err -Tail 100`; 95% 是 .env 配错或网关全断 |
| 数据库出错 | 从备份还原: `Copy-Item D:\smart-control\backups\<最新>\smart-control.db D:\smart-control\database\smart-control.db -Force` 再 restart |
| 主机彻底死机 | 物理按电源键长按 10s 强关机 → 重新开机 → 自动登录 + PM2 自启会恢复 (除非配错过) |

---

## 4. 一表速查 (Cheat Sheet)

```
═══════════════════════════════════════════════════════════════
  GK9000 中控主机 速查表
═══════════════════════════════════════════════════════════════

接入:
  • 现场局域网平板:   http://192.168.50.10/control/
  • 后台管理:          http://192.168.50.10/control/#/admin
  • 远程 (Tailscale):  http://100.x.x.x/control/
  • 工程师 RDP:        mstsc → 100.x.x.x

应急 PowerShell (RDP 进主机后):
  cd D:\smart-control
  .\scripts\restart.ps1        ← 平滑重启
  .\scripts\restart.ps1 -Hard  ← 强制重启 (服务挂了用)
  .\scripts\logs.ps1 -Err      ← 只看错误日志
  .\scripts\backup.ps1         ← 立即备份
  .\scripts\update.ps1         ← 同步云端代码

PM2:
  pm2 list                          ← 进程状态
  pm2 logs --lines 100              ← 最近 100 行
  pm2 monit                         ← 实时仪表盘
  pm2 restart smart-control-backend ← 重启

健康检查:
  浏览器: http://192.168.50.10/control/api/system/health
  PowerShell: Invoke-RestMethod http://localhost:3000/api/system/health

文件位置:
  代码:    D:\smart-control\
  数据库:  D:\smart-control\database\smart-control.db
  配置:    D:\smart-control\backend\.env
  日志:    D:\smart-control\logs\
  备份:    D:\smart-control\backups\

紧急联系: [此处填驻场工程师电话]
═══════════════════════════════════════════════════════════════
```

---

## 5. 应急操作卡 (打印贴主控室墙上)

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│      金湖展贸中心智能控制系统 · 应急操作卡                  │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  现象 1: 平板打不开页面                                     │
│    1. 看主机电源灯是否亮                                    │
│    2. 看主机背后两根网线是否插好                            │
│    3. 找驻场工程师                                          │
│                                                             │
│  现象 2: 某区灯打不开                                       │
│    1. 看灯具是否物理通电                                    │
│    2. 平板 → 灯光页 → 重试                                  │
│    3. 后台 → 设备管理 → 找对应灯光设备 → 看状态             │
│    4. 找驻场工程师                                          │
│                                                             │
│  现象 3: 主机死机 (远程也连不上)                            │
│    1. 物理找到主机 (1F 弱电机柜)                            │
│    2. 长按电源键 10 秒强制关机                              │
│    3. 等 30 秒再按电源键开机                                │
│    4. 等 2 分钟自动恢复 (系统自启)                          │
│    5. 平板试: http://192.168.50.10/control/                 │
│    6. 仍不行 → 找驻场工程师                                 │
│                                                             │
│  现象 4: 火警 / 紧急情况                                    │
│    1. 优先按消防 / 安全流程, 不要管中控                     │
│    2. 中控会随建筑断电安全关停                              │
│                                                             │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  驻场工程师: [姓名]   电话: [号码]                          │
│  IT 支持:    [姓名]   电话: [号码]                          │
│  主机位置:   1F 弱电机柜内                                  │
│  主机 IP:    192.168.50.10                                  │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

> 把这段框起来打印 A4, 塑封后贴在主控室门内侧、平板控制台旁、弱电机柜上, 各 1 份.

---

## 6. 文档地图 (按需深入)

| 我想了解... | 看哪个文档 |
| --- | --- |
| **本文档** | 日常运维总入口 (HOST_OPERATIONS.md) ← 你在这 |
| 主机首次系统配置 (Windows 网络/防火墙/自启) | [GK9000_FIELD_SETUP.md](GK9000_FIELD_SETUP.md) |
| 应用首次部署 (装 Node/PM2/clone 代码) | [Sprint-01-Windows-部署.md](Sprint-01-Windows-部署.md) |
| 完整部署手册 (Sprint-10 体系) | [../DEPLOY_WINDOWS.md](../DEPLOY_WINDOWS.md) |
| 上线 44 项检查清单 | [../PRODUCTION_CHECKLIST.md](../PRODUCTION_CHECKLIST.md) |
| 每周巡检流程 | [../WINDOWS_MAINTENANCE.md](../WINDOWS_MAINTENANCE.md) |
| 代码更新 (云端 → 现场) | [ONSITE_UPDATE.md](ONSITE_UPDATE.md) |
| DALI 灯光现场施工 | [DALI_FIELD_INSTALL.md](DALI_FIELD_INSTALL.md) |
| LED 大屏现场施工 | (暂无, 待写) |
| 音响 DSP 现场施工 | [AUDIO_FIELD_INSTALL.md](AUDIO_FIELD_INSTALL.md) |
| 中央空调现场施工 | [HVAC_FIELD_INSTALL.md](HVAC_FIELD_INSTALL.md) |

---

## 7. 三类人 三个动作

| 你是谁 | 你天天要看的 | 偶尔要看的 | 几乎不看的 |
| --- | --- | --- | --- |
| **运营人员** (前台/接待) | 平板 `/control/` | 后台 `/admin/` 看日志 | PowerShell |
| **设施管理员** | 后台 `/admin/` 全部 | PowerShell `restart.ps1` / `logs.ps1` | Windows 系统设置 |
| **驻场工程师** | 后台 `/admin/` + PM2 监控 | PowerShell 全套 + `update.ps1` | 改 .env / 改代码 |
| **远程开发** (我) | 代码 + git | CI/CD 状态 + 远程后台 | 现场物理 |

---

## 8. 安全提醒

1. **改默认密码**: 首次登录 `admin / admin123` 立即去 `/admin/#/users` 改强密码
2. **加员工账号**: 不要让所有人都用 admin, 按职责开 operator / viewer 账号
3. **.env 永远不要分享出去**: 里面有设备 IP, 是入侵起点
4. **远程操作前先看设备网状态**: 远程 `restart.ps1` 时, 如果设备网断开, 服务起不来你会以为是软件问题
5. **重大变更前必备份**: `.\scripts\backup.ps1`, 备份在 `D:\smart-control\backups\`
6. **不要在展会期间更新**: 周一上午闭馆日是最佳更新窗口
