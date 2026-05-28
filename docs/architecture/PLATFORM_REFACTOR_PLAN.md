# 平台化重构方案 — 从"设备硬编码"走向"后台可配置"

> 创建于 2026-05-28
> 起因:用户反馈"每改 IP 都要改代码部署 / 没法在后台增删设备 / 产品无法集成化规范化"
> 目标:把当前"硬编码进系统"的设备 / 协议 / 寻址 / 通道 / 场景动作,逐步迁移到后台可配置
> 参考:Niagara N4 / HomeAssistant / OpenHAB / Thingsboard / Crestron Pyng 的标准 IoT 三层架构

---

## 一、可行性分析

### 可数据化的部分(后台配置 = DB)✅

| 层 | 例子 |
|---|---|
| **设备实例** | "这台 USR 转换器在 192.168.50.20, 叫前厅网关" |
| **协议参数** | slaveId / 波特率 / TCP 端口 / 帧间隔 / 超时 / 重试次数 |
| **拓扑关系** | "这条 DALI 总线挂在 CONV-RTU-1 上, 19 个驱动器, 分 12 个 group" |
| **场景动作** | "开馆模式 = group 1 调 80% + group 4 调 70% + LED 切欢迎页 + 音响开背景音" |
| **命名/品牌信息** | 厂商、型号、备注、安装时间、固件版本、序列号 |

### 不能纯数据化的部分(必须留代码)⚠️

| 层 | 为啥 | 例子 |
|---|---|---|
| **协议解码/编码** | 寄存器位序、CRC、帧结构是死规矩 | CY-DALI64A 的"群组亮度写在 0x0001+(g-1)×8, fade 时间在高 8 位, raw 亮度在低 8 位" |
| **专有命令格式** | 厂家文档怎么写就怎么实现 | EKX-808 音响的 SetVolume 用 `["set","master_volume",75]` 这种 JSON 帧 |
| **状态轮询逻辑** | 不同设备探活方式不同 | DALI 读 0x0001, LED 屏读 0xC001, 空调 read coil |

### 结论

不是"代码全删", 而是**两层分工清晰**:
- **代码层 = 协议驱动模板 (driver)** — 描述"这种品牌型号能做什么、怎么编解码"
- **DB 层 = 设备实例 + 通道 + 关系** — 描述"现场有几台、装哪、谁连谁"

这就是 HomeAssistant 的 "integration / device / entity" 模型,行业标准。

---

## 二、目标架构

```
┌─────────────────────────────────────────────────────────────┐
│              代码 (Driver Templates)                        │
│  按品牌型号一个 class, 描述"它能做什么 + 怎么编解码"        │
│  CyDali64aDriver / NovaLedDriver / EkxDspDriver / ...      │
│                                                              │
│  接口: connect() / disconnect() / sendCommand(cmd, params)  │
│  能力: getCapabilities() → ["turn_on","turn_off","set_bri", │
│           "set_color_temp","recall_scene",...]              │
└───────────────────┬─────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────┐
│              DB (Device Instances)                          │
│  hardware_unit 表 (现成的, Phase 3 扩展):                  │
│    code / name / driverKind(FK→driver_template) /          │
│    vendor / model / ip / port /                            │
│    addressing(JSON) / channels(JSON) /                     │
│    enabled / status / installedAt / firmwareVersion        │
│                                                              │
│  driver_template 表 (Phase 2 新建):                        │
│    kind(PK) / displayName / vendor / protocol /            │
│    capabilitiesJson / defaultAddressingJson /              │
│    paramSchemaJson                                          │
│                                                              │
│  device 表 (现成, 逻辑设备):                                │
│    name / category / gatewayId(FK→hardware_unit) /         │
│    addressing(JSON) / zoneId / floor                       │
│                                                              │
│  scene + scene_action 表 (现成)                            │
└───────────────────┬─────────────────────────────────────────┘
                    │
┌───────────────────▼─────────────────────────────────────────┐
│              UI (后台管理)                                  │
│  /admin/gateways         网关管理 (Phase 3 新)              │
│  /admin/hardware         已有, Phase 3 扩成"所有设备实例"   │
│  /admin/drivers          驱动模板浏览 (Phase 2 新, 只读)    │
│  /admin/devices          已有, 跟 hardware 关联             │
│  /admin/scenes           已有                              │
│  /admin/scene-actions    已有                              │
└─────────────────────────────────────────────────────────────┘
```

---

## 三、分四期整改

### Phase 1 — 让所有 adapter 都从 DB 读配置 (2-3h)

DALI 已经做了(commit 9e612d4),推广到其它三个 adapter。

- **LedAdapter** / **AudioAdapter** / **HvacAdapter** 都改成 `getConfigFromDb()` 读 hardware_unit
- 所有 adapter 通用接口:`syncRuntime()` + 5s 缓存 + IP 改完即时生效
- 后台编辑 hardware_unit 任何条目 → 对应 adapter 自动 rewire

**产出**:任何设备 IP / 端口 / 参数都能后台改,不重启不部署。

### Phase 2 — 驱动模板注册中心 (3-4h)

- 新建 `driver_template` 表:
  - `kind` (PK)
  - `displayName`
  - `vendor`
  - `protocol`
  - `capabilitiesJson`
  - `defaultAddressingJson`
  - `paramSchemaJson`
- backend 启动时扫描代码里的所有 `*.driver.ts`,自动登记到 `driver_template`(代码是事实来源,DB 是镜像)
- 后台 `/admin/drivers` 页面 — 只读浏览,用户能看"系统支持哪些品牌哪些型号,各自能做什么"

**产出**:用户在 UI 上能看 "我要加一台 LTECH LT-84A,系统支持吗?",而不是要问开发。

### Phase 3 — hardware_unit 跟驱动模板挂钩 (2-3h)

- hardware_unit 加 `driverKind` 字段(外键 → driver_template)
- 后台编辑硬件时:先选"驱动模板"(下拉,带搜索)→ 自动填默认 addressing → 用户只填实例特有的(IP / location 等)
- 类比:Niagara N4 的 "JACE 拖一个 NDriver 进去就有了所有 Modbus 行为"

**产出**:加一台新设备 = 选模板 + 填 IP,不写一行代码。

### Phase 4 — 后台"加新品牌"自助化 (8-12h, 可选)

- 新驱动模板可以**纯 UI 创建**(描述协议、寄存器表)
- 真正接入新品牌:开发新 driver class → push → 重启
- 但 99% 设备品牌已经预置
- 写一份"驱动开发指南",外部团队也能贡献

**产出**:除非接全新品牌,平时**完全无需改代码**。

### Phase 5 — 配置版本化 (2-3h, 后期)

- hardware_unit 改动写入 `audit_log` 表(谁、什么时间、改了什么)
- 后台"配置历史"页 — 看变更轨迹、回滚到任意历史版本
- 可选:导出 / 导入整个配置文件,工程现场快速复制

**产出**:配置当代码管,有审计、能回滚、能复制。

---

## 四、优先级 + 工时建议

| Phase | 工时 | 优先级 | 立刻收益 |
|---|---|---|---|
| **1** 全 adapter DB 化 | 2-3h | **必做** | 任何 IP 后台改即生效 |
| **2** driver 模板注册 | 3-4h | 高 | 用户能浏览支持哪些品牌 |
| **3** 模板 + 实例挂钩 | 2-3h | 高 | 加新设备无代码 |
| **4** UI 自助创建驱动 | 8-12h | 中 | 外部团队能贡献 |
| **5** 配置版本化 | 2-3h | 中 | 审计 + 回滚 |

**建议先做 1 + 3,合计 4-6 小时,80% 痛点解决**。

---

## 五、硬代码不可避免的边界

诚实说一下边界,避免后期期望落差:

- **新协议接入**:你买了一台用专有协议的设备(比如某品牌私有 RS-232 帧),没人写过 driver → 必须代码层加新 driver class。但这是**一次性工作**,完成后 N 台同型号设备都是后台配
- **协议解码 bug**:某条寄存器算错 → 代码改,部署。这不可避免
- **新增"能力"**(比如想给灯加个"色温自动跟时间"功能)→ 代码改

但这些**全是"扩展系统能力"的活儿**,不是"加台新设备就要改代码"。

---

## 六、当前进度

- ✅ Phase 1 之 DALI 部分(commit 9e612d4):CyDali64aAdapter 从 DB 读 CONV-RTU-1 配置,后台改 IP 5s 内 rewire,不重启
- ✅ 硬件清单 UI(commit cca0cef):addressing / channels 两个 JSON textarea 改成结构化表单(Modbus 从机地址 / 波特率 / 帧间隔 / DALI 起始 / 通道清单表格)
- ⏳ Phase 1 剩余:LED / Audio / HVAC 三个 adapter 还在硬编码 env
- ⏳ Phase 2 / 3 / 4 / 5 待启动

---

## 七、决策记录

- 2026-05-28 用户确认架构方向,等后续指令决定开始 Phase 1 剩余 / Phase 3 / 都做
