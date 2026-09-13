# 中央空调功能区 (HVAC Zones) — 场景配置参考

> 金湖展贸中心智能控制系统 · 14 个功能区, 覆盖 22 台物理内机
> 用于: 场景动作配置 / 平板分组控制 / 区级批量操作
> 配置源: `backend/src/adapters/hvac/hvac-zones.ts`

---

## 0. 设计原则

物理上 22 台内机, 每台都能独立寻址 (indoorIdx 1-22), 但日常**业务场景**很少需要操作单台.

引入"**功能区**"概念, 把内机按用途分组:
- 一个区 = 一个业务场景对应的物理空间 (如"路演区" / "会议室")
- 区内 1-3 台内机, 由区做统一管理
- 场景动作目标 = 区代号 (而不是 22 个 indoorIdx)

举例: "开馆模式"想给所有展示区开空调到 24°C 制冷, 配置时:
- ❌ 旧方式: 22 个 SceneAction × (turnOn / setTemperature 24 / setMode cool) = 66 个动作
- ✅ 新方式: 6 个区级 SceneAction (一次操作扇出到内机) = 18 个动作

---

## 1. 区总览 (14 个)

| code | 区名 | 楼层 | 内机数 | 内机型号 | indoorIdx |
| --- | --- | --- | --- | --- | --- |
| `enterprise_booth` | 企业展位 | 1F | 3 | DLR-63F × 3 | 1, 2, 3 |
| `livestream` | 直播间 | 1F | 1 | DLR-71F | 4 |
| `foreign_trade` | 外贸交易展示区 | 1F | 2 | DLR-71F + DLR-80F | 5, 6 |
| `park_display` | 园区展示 | 1F | 1 | DLR-90F | 7 |
| `roadshow` | 路演发布洽谈区 | 1F | 2 | DLR-100F + DLR-112F | 8, 9 |
| `showcase` | 企业综合展销区 | 1F | 1 | DLR-125F | 10 |
| `group_mgmt` | 集团产业管理中心 | 2F | 1 | DLR-90F | 11 |
| `decision_center` | 投资决策中心 | 2F | 1 | DLR-90F | 12 |
| `meeting_room` | 会议室 | 2F | 1 | DLR-90F | 13 |
| `shared_office` | 共享办公室 | 2F | 2 | DLR-90F × 2 | 14, 15 |
| `service_center` | 企业服务中心 | 2F | 2 | DLR-90F × 2 | 16, 17 |
| `command_center` | 园区运营指挥中心 | 2F | 2 | DLR-90F × 2 | 18, 19 |
| `lobby_2f` | 二层前厅 | 2F | 2 | DLR-100F × 2 | 20, 21 |
| `research_center` | 产业研究中心 | 2F | 1 | DLR-100F | 22 |

---

## 2. REST API

### 2.1 列出所有区

```
GET /api/hvac/zones
→ [{ code, name, floor, indoors: [1,2,3], desc }, ...]
```

### 2.2 区级动作 (扇出到该区所有内机)

```
POST /api/hvac/zone/{code}/on            # 开机
POST /api/hvac/zone/{code}/off           # 关机
POST /api/hvac/zone/{code}/temperature   # body: { value: 24 }
POST /api/hvac/zone/{code}/mode          # body: { mode: "cool"|"heat"|"fan"|"auto"|"dry" }
POST /api/hvac/zone/{code}/fan-speed     # body: { speed: "auto"|"low"|"mid"|"high" }

→ { total, okCount, failCount, results: [{ indoorIdx, ok, error?, durationMs }, ...] }
```

### 2.3 单内机动作 (区内细控, 兼容旧 API)

```
POST /api/hvac/{indoorIdx}/on       # indoorIdx 1-22
POST /api/hvac/{indoorIdx}/off
POST /api/hvac/{indoorIdx}/temperature   { value: 24 }
POST /api/hvac/{indoorIdx}/mode          { mode: "cool" }
POST /api/hvac/{indoorIdx}/fan-speed     { speed: "mid" }
```

---

## 3. 场景动作配置

后台 `/admin/#/scene-actions` 配置场景动作时:

| 字段 | 区级动作 | 单机动作 |
| --- | --- | --- |
| `deviceType` | **`hvac-zone`** | `hvac` |
| `deviceId` | zone code (例 `roadshow`) | indoorIdx (例 `8`) |
| `command` | `turnOn` / `setTemperature` / ... | 同左 |
| `params` (JSON) | `{"value":24}` / `{"mode":"cool"}` | 同左 |

---

## 4. 场景配置示例

### 4.1 开馆模式 (opening)

| # | deviceType | deviceId | command | params |
| --- | --- | --- | --- | --- |
| 1 | hvac-zone | `park_display` | turnOn | — |
| 2 | hvac-zone | `park_display` | setMode | `{"mode":"cool"}` |
| 3 | hvac-zone | `park_display` | setTemperature | `{"value":24}` |
| 4 | hvac-zone | `enterprise_booth` | turnOn | — |
| 5 | hvac-zone | `enterprise_booth` | setTemperature | `{"value":24}` |
| 6 | hvac-zone | `lobby_2f` | turnOn | — |
| 7 | hvac-zone | `lobby_2f` | setTemperature | `{"value":24}` |

→ 一次执行涉及 3+3+2 = 8 台内机, 但只需要 7 个 SceneAction.

### 4.2 路演模式 (roadshow)

| # | deviceType | deviceId | command | params | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | hvac-zone | `roadshow` | turnOn | — | 路演区内 2 台 |
| 2 | hvac-zone | `roadshow` | setMode | `{"mode":"cool"}` | |
| 3 | hvac-zone | `roadshow` | setTemperature | `{"value":22}` | 路演聚集人多, 设低 |
| 4 | hvac-zone | `roadshow` | setFanSpeed | `{"speed":"mid"}` | |

### 4.3 会议模式 (meeting)

| # | deviceType | deviceId | command | params |
| --- | --- | --- | --- | --- |
| 1 | hvac-zone | `meeting_room` | turnOn | — |
| 2 | hvac-zone | `meeting_room` | setTemperature | `{"value":23}` |
| 3 | hvac-zone | `meeting_room` | setFanSpeed | `{"speed":"low"}` |

### 4.4 接待模式 (reception)

| # | deviceType | deviceId | command | params |
| --- | --- | --- | --- | --- |
| 1 | hvac-zone | `lobby_2f` | turnOn | — |
| 2 | hvac-zone | `lobby_2f` | setMode | `{"mode":"cool"}` |
| 3 | hvac-zone | `lobby_2f` | setTemperature | `{"value":24}` |
| 4 | hvac-zone | `decision_center` | turnOn | — |
| 5 | hvac-zone | `decision_center` | setTemperature | `{"value":23}` |

### 4.5 清洁模式 (cleaning)

| # | deviceType | deviceId | command | params | 备注 |
| --- | --- | --- | --- | --- | --- |
| 1 | hvac-zone | `enterprise_booth` | turnOff | — | 清洁时关掉非必要区域省电 |
| 2 | hvac-zone | `roadshow` | turnOff | — | |
| 3 | hvac-zone | `meeting_room` | turnOff | — | |
| 4 | hvac-zone | `lobby_2f` | setTemperature | `{"value":26}` | 前厅保留但提温节能 |

### 4.6 闭馆模式 (closing)

只需 **14 个动作**, 不是 22 个:

| # | deviceType | deviceId | command |
| --- | --- | --- | --- |
| 1-14 | hvac-zone | (所有 14 个区 code) | turnOff |

或干脆做一个 "全关" 简单循环, 写 1 个 admin 工具函数.

---

## 5. 平板控制 (HvacPage)

平板访问 `/control/#/hvac`:

- 按楼层分两段展示 (1F 6 区 / 2F 8 区)
- 每个区一张卡, 显示:
  - 区名 + 内机数 + 内机型号摘要
  - 区级状态 (运行中 / 已关机 / 部分开 / 故障)
  - 区级温度 (取该区内机平均) + 加减按钮
  - 区级模式 / 风速 (所有内机相同才高亮, 不同则显示无选中)
  - "整区开机" / "整区关机" 两个大按钮
- 单台内机 ≥ 2 时, 点 "查看内机明细" 展开下方列表, 可单独开/关每台

---

## 6. 命名约定 / 改区代号注意

- code 用**小写下划线**, URL 安全, 不含数字下标 (区是逻辑分组, 内机数会变)
- 改 code → 已配的场景动作 deviceId 会失效, 必须同步改场景配置
- 加新区 → 修改 `hvac-zones.ts` 后重启后端

---

## 7. 关联文档

| 文档 | 用途 |
| --- | --- |
| [HVAC_FIELD_INSTALL.md](HVAC_FIELD_INSTALL.md) | 物理接线 / 拨码 / 寄存器表 |
| [EQUIPMENT_LIST.md](EQUIPMENT_LIST.md) | 设备清单 |
| `backend/src/adapters/hvac/hvac-zones.ts` | 区代号 → 内机映射的代码定义 |
| `backend/src/services/command-dispatcher.service.ts` | `hvac-zone` 类型动作分发 |
