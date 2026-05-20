# 音响子系统现场施工与调试 SOP

> 金湖展贸中心智能控制系统 · 音响子系统现场安装与调试指引
> 适用于：DSPPA / ITC DSP 处理器 + 定压功放 + 吸顶喇叭 + 无线麦
> 估时：单人 6-8 小时（含 DSP 编程 + 分区联调）

---

## 0. 系统架构概览

```
┌────────────────┐  TCP/IP  ┌──────────────────┐
│ ARK-1220L 主机 │──────────│ 弱电交换机        │
│ 192.168.50.10  │          │ TL-SG1016D       │
└────────────────┘          └─────────┬────────┘
                                      │ 网线
                                      ▼
                       ┌────────────────────────────┐
                       │ DSPPA MAG6816 DSP 处理器    │
                       │ 192.168.50.40              │
                       │ 6 路 MIC + 2 路 LINE 输入   │
                       │ 8 路 LINE 输出 → 功放        │
                       └────────────┬───────────────┘
                                    │ 音频线 (XLR/RCA)
                                    ▼
                       ┌────────────────────────────┐
                       │ 定压功放 4×500W (1 台)      │
                       │ 4 路定压 70V/100V 输出       │
                       └────────────┬───────────────┘
                                    │ 喇叭线 RVS 2×1.5mm²
                                    │
              ┌─────────────────────┼──────────────────────┐
              │                     │                      │
        ┌─────▼────┐         ┌─────▼────┐          ┌─────▼────┐
        │ 1F 背景音 │         │ 2F 背景音 │          │ 会议区   │
        │ 吸顶 ×N  │         │ 吸顶 ×N  │          │ 吸顶 ×N  │
        └──────────┘         └──────────┘          └──────────┘

输入侧 (从前端到 DSP):
    无线话筒接收器 → DSP MIC 输入 1-2
    会议麦克风     → DSP MIC 输入 3-4
    紧急广播话筒   → DSP MIC 输入 5 (优先级最高)
    NUC 背景音乐播放 → DSP LINE 输入 1
    路演主机声卡   → DSP LINE 输入 2

输出侧 (从 DSP 到功放):
    DSP OUT 1 → 功放 CH1 → 1F 背景音吸顶组 (1f_bg)
    DSP OUT 2 → 功放 CH2 → 2F 背景音吸顶组 (2f_bg)
    DSP OUT 3 → 功放 CH3 → 会议区 (meeting)
    DSP OUT 4 → 功放 CH4 → 路演区 (roadshow)
    DSP OUT 5-8 → 备用 (未来扩展或紧急广播)
```

## 1. 设备清单 (BOM)

| 编号 | 设备 | 数量 | 厂商 / 型号 | 用途 |
| --- | --- | --- | --- | --- |
| AUDIO-DSP-1 | 音频 DSP 处理器 | 1 | DSPPA MAG6816（或 ITC T-6201 等同级） | 8×16 矩阵 + 网络控制 |
| AUDIO-AMP-1 | 定压功放 | 1 | DSPPA MAG2500（4×500W 70V/100V）或同级 | 驱动吸顶喇叭 |
| AUDIO-SPK | 吸顶喇叭 | 20-40 个 | 6W/12W 定压 70V 吸顶 | 各分区分布 |
| AUDIO-MIC-W | 无线手持话筒 | 2-4 套 | 舒尔 / 森海塞尔 / 国产同级 | 接待 / 会议 |
| AUDIO-MIC-WC | 无线接收器 | 1-2 套 | 与话筒成套 | 接 DSP MIC 输入 |
| AUDIO-MIC-CO | 会议鹅颈麦 | 视会议室人数 | 国产同级 | 会议讨论 |
| AUDIO-MEDIA | 媒体播放主机 | 1 | Intel NUC 或专用 BGM 主机 | 播放背景音乐文件 |

**金湖项目最小配置**：1 DSP + 1 功放 + 20 喇叭 + 2 无线麦 + 1 NUC ≈ ¥25,000-35,000

## 2. 工具准备

**必备**：

- 万用表（测喇叭线阻抗 / 电源电压）
- 网线测试仪 + 备用 Cat5e 网线
- 笔记本电脑（运行 DSPPA Pro 控制软件 / DSP 编程）
- 音源测试设备：手机或 MP3 播放器（带 3.5mm 输出）
- 标签机或绝缘胶带 + 油性笔
- 一字 + 十字螺丝刀

**推荐**：

- 声压计 / 分贝仪（测各分区声压均匀度）
- 长备用音频线（XLR 5m × 2 / 3.5mm 转 RCA × 1）
- 喇叭线 RVS 2×1.5mm²（按现场布线长度估算）
- 0.5mm² 屏蔽线（话筒线，>10m 走线必备）

---

## 3. 物理安装

### 3.1 弱电机柜内（DSP + 功放）

**机柜推荐布局**（19" 标准机柜）：

```
┌───────────────────────────────┐
│  [1U]  通风口                  │
├───────────────────────────────┤
│  [3U]  DSPPA MAG6816 DSP      │ ← 信号处理核心
├───────────────────────────────┤
│  [1U]  跳线槽 (用于音频线整理) │
├───────────────────────────────┤
│  [3U]  DSPPA MAG2500 功放     │ ← 4×500W
├───────────────────────────────┤
│  [1U]  PDU (8 位排插)         │
└───────────────────────────────┘
```

**散热**：DSP 和功放都发热，**机柜必须留通风**，建议加 1U 散热风扇。功放后部预留 10cm 空间。

**电源**：DSP 接 220V 普通插座；功放**单独接 220V 16A 空开**（500W × 4 = 2KW 峰值）。

### 3.2 吸顶喇叭分布

按现场设计图纸装：

| 分区 | 喇叭数 | 间距 | 选型 |
| --- | --- | --- | --- |
| 1F 背景音 (前厅 / 园区展示 / 走廊) | 8-12 | 3-4m | 6W/100V 定压吸顶 |
| 2F 背景音 (前厅 / 走廊) | 6-8 | 3-4m | 6W/100V 定压吸顶 |
| 会议区 | 2-4 | 紧凑 | 12W/100V（要求清晰度） |
| 路演区 | 4-6 | 3m | 12W/100V（要求音量） |

**安装注意**：

- 吊顶留**Φ160mm-180mm 开孔**（不同型号尺寸不同，看产品说明）
- 喇叭线**串联**接入同一回路（定压 100V 系统支持长串联，阻抗不变）
- **正负不能反接**（部分喇叭有方向，避免相位抵消）
- 每个喇叭独立标号 `1F-BG-S01` ~ `1F-BG-S12`，便于排故

### 3.3 喇叭线布线

定压系统用 RVS 2×1.5mm² 双绞线即可（普通灯线规格）：

```
功放 70V/100V OUT (+) ──┬─ 喇叭 #1 (+) ─┬─ 喇叭 #2 (+) ─┬─ ... ─┐
                         │                │                │       │ 串联到末端
功放 70V/100V OUT (-) ──┴─ 喇叭 #1 (-) ─┴─ 喇叭 #2 (-) ─┴─ ... ─┘
```

**总线总长** ≤ 200m，超过用更粗线（2.5mm²）减阻抗损耗。

### 3.4 话筒与音源接线

**话筒到 DSP**：

```
无线话筒接收器 → XLR 平衡线 → DSP MIC IN 1 (打开 +48V Phantom 如果是电容麦)
会议鹅颈麦     → 同上 → DSP MIC IN 2
紧急广播麦     → 同上 → DSP MIC IN 5 (后面 Preset 里设最高优先级)
```

**音源到 DSP**：

```
NUC HDMI → 4K HDMI 矩阵 (如有) → 投屏
NUC 3.5mm 音频输出 → 3.5mm 转双 RCA → DSP LINE IN 1
路演主机声卡 → 同上 → DSP LINE IN 2
```

XLR 线 > 10m 一定要走屏蔽，否则容易感应到嗡声 / 干扰。

### 3.5 DSP 到功放

DSP 输出口 (一般是欧式凤凰端子 3.5mm 或 6.35mm) → 功放输入 (RCA / XLR / 凤凰端子):

```
DSP OUT 1 (+,-) → 平衡音频线 → 功放 INPUT 1 (+,-)
DSP OUT 2       → ...        → 功放 INPUT 2
DSP OUT 3       → ...        → 功放 INPUT 3
DSP OUT 4       → ...        → 功放 INPUT 4
```

记好对应关系：**DSP OUT N → 功放 CH N → 分区 N**。

### 3.6 DSP 网络接线

DSP 后部 RJ45 网口 → 弱电交换机任意一个口：

```
DSPPA MAG6816 LAN → Cat5e 网线 → TP-LINK 交换机
```

---

## 4. 软件配置

### 4.1 DSP 初始网络配置

**出厂默认**: 通常是 `192.168.1.100` 或 `192.168.0.100`（看具体型号 + 厂家手册）。

**配置方法**:

| 方法 | 步骤 |
| --- | --- |
| A. 厂家专用工具 | 用 DSPPA 提供的 PC 软件（如 "DSPPA Network Tool"）扫描局域网设备并改 IP |
| B. Web 后台 | 部分型号支持浏览器访问设备 IP，账号密码默认 `admin/admin` |
| C. RS-232 串口 | 部分型号带串口配置（应急） |

**目标配置**：

| 项 | 值 |
| --- | --- |
| IP | `192.168.50.40` |
| 子网掩码 | `255.255.255.0` |
| 网关 | `192.168.50.1` |
| API 端口 | `80`（HTTP）或 `8080`（看厂家协议） |
| API Key / 密码 | 看厂家协议手册（如有） |

### 4.2 DSP 矩阵编程（用厂家 PC 软件）

这是音响系统**最复杂的一步**，必须用厂家的图形化配置软件（DSPPA Pro / ITC Audio Designer 等）。

**步骤**：

1. 笔记本接交换机，跑厂家软件，**连接到 DSP** (`192.168.50.40`)
2. **创建矩阵路由**：

   ```
   背景音乐 (LINE IN 1) ──┬──→ OUT 1 (1F 背景音)
                          ├──→ OUT 2 (2F 背景音)
                          ├──→ OUT 3 (会议区)
                          └──→ OUT 4 (路演区)

   接待无线麦 (MIC 1)   ────→ OUT 1, 2 (1F + 2F 全播)

   会议麦 (MIC 3, 4)   ────→ OUT 3 only (只在会议区出声)

   紧急广播 (MIC 5)    ════→ OUT 1, 2, 3, 4 (全分区, 优先级 ducking)
                            ↑
                            (开启 Priority Ducking, 麦克风一开其他源压低 -20dB)

   路演主机 (LINE IN 2) ───→ OUT 4 (路演区)
   ```

3. **配置 DSP 模块链**（每路输出）：

   ```
   IN → [Mute] → [Gain] → [4-band Parametric EQ] → [Compressor] → OUT
   ```

   - **EQ**: 低频 -3dB @ 80Hz（防嗡）, 高频 +2dB @ 8kHz（清晰）
   - **Compressor**: ratio 4:1, threshold -12dB（防爆音）

4. **音量初始值**：
   - 背景音 LINE IN: -6dB
   - MIC: -10dB（加 +48V Phantom 后会增益）
   - 各 OUT 主音量: -12dB（留余量）

5. **保存到 Preset** "Default" 槽 (开机默认加载)

6. **保存第二份 Preset** "Emergency" — 把所有 BGM 静音 + MIC 5 全分区最大音量，给应急广播用

### 4.3 中控对接

#### 4.3.1 确认 DSP 控制协议

⚠ **关键**：当前 `RealAudioAdapter` 假设的是通用 REST API：

```
PUT  /api/zones/<zone>/volume   {value:0..100}
POST /api/zones/<zone>/mute      {muted:bool}
POST /api/zones/<zone>/source    {source:'bgm'|'mic'|'off', track?:string}
GET  /api/zones/<zone>           -> {volume, muted, source, ...}
GET  /api/health                 -> {status:'ok'}
```

但 **DSPPA MAG6816 真实协议可能不是这个格式**。必须做以下确认：

1. 找 DSPPA 厂家要 **TCP/IP 通讯协议文档**（一般是 PDF 或 Word）
2. 看协议是 **REST / WebSocket / 私有 ASCII / Modbus** 哪种
3. 如果跟我们假设的不一样，需要**改写 `real-audio.adapter.ts`** 适配

**常见 DSPPA 协议**：

| 协议 | 特征 | 适配难度 |
| --- | --- | --- |
| HTTP REST | URL 路径 + JSON | 直接用现有 adapter，改改 URL 就行 |
| 私有 ASCII over TCP | `<STX>CMD:zone:value<ETX>` 这种 | 需要新写一个 TCP client + 协议解析（半天） |
| Modbus TCP | 寄存器读写 | 借用已有的 `modbus-tcp.ts`（1-2 小时） |
| WebSocket | 实时双向 | 新写 WS 客户端（1 天） |

#### 4.3.2 .env 配置

```ini
AUDIO_HOST=192.168.50.40
AUDIO_PORT=80              # 看厂家协议确定真实端口
AUDIO_DEFAULT_ZONE=1f_bg
# AUDIO_API_KEY=xxxxx      # 如厂家要求鉴权
```

应用：

```powershell
pm2 reload smart-control-backend --update-env
```

#### 4.3.3 4 个分区命名（前后端约定）

| zone 字符串 | 中文 | 接哪条 DSP 输出 |
| --- | --- | --- |
| `1f_bg` | 一层背景音 | OUT 1 |
| `2f_bg` | 二层背景音 | OUT 2 |
| `meeting` | 会议区 | OUT 3 |
| `roadshow` | 路演区 | OUT 4 |

如果现场分区不一样（比如增加 F102/F103 独立分区），需同步改：

1. `frontend/src/pages/AudioPage.vue` 的 `channels` 数组
2. `backend/src/seed/seed.service.ts` 的 audio 设备
3. DSP 矩阵编程里多加输出路由
4. 接更多功放通道

---

## 5. 联调测试

### 5.1 物理层 → 中控层逐步验证

**Step 1 — 网络连通**

```powershell
ping 192.168.50.40
# 期望: 4 个回应

Test-NetConnection 192.168.50.40 -Port 80
# 期望: TcpTestSucceeded: True
```

**Step 2 — 厂家工具直连 DSP**

笔记本跑 DSPPA Pro → 连接 DSP → 看 OUT 1-4 通道是否能本地直接控制音量 → 喇叭是否出声

如果**厂家工具能控制但中控连不上**：协议不对，需要改 adapter（见 §4.3.1）

**Step 3 — 中控 API 探活**

```powershell
curl -X POST http://localhost:3000/api/system/runtime/health/probe
curl http://localhost:3000/api/system/runtime/gateways | ConvertFrom-Json | Select-Object -ExpandProperty data
# 期望: gateway "audio-dsp" state: "online"
```

**Step 4 — 平板控制**

打开 https://cnjinhu.top/control/#/audio 或本机 `http://localhost/`：

- 「一层背景音」音量滑到 50 → 1F 喇叭出声且音量适中
- 点「静音」→ 1F 喇叭无声，DSP 状态变橙黄
- 取消静音 → 恢复
- 「麦克风开」→ 接到 1F 的无线话筒可正常说话
- 在「背景音乐」框输入 `welcome` 点播放 → 播放欢迎背景音乐
- 点停止 → 停止

### 5.2 各分区独立测试

依次切换：

| 分区 | 期望表现 |
| --- | --- |
| 1F 背景音 | 只有 1F 喇叭出声，2F/会议/路演静 |
| 2F 背景音 | 只有 2F 喇叭出声 |
| 会议区 | 只有会议区出声 + 会议麦优先 |
| 路演区 | 只有路演区出声 |

任何一个分区**串台**（多分区一起响），说明 DSP 矩阵路由配错了，回 §4.2 重排。

### 5.3 麦克风优先级测试

播放背景音乐时，**按下紧急话筒**：

- 全部 4 个分区**自动压低音乐**到 -20dB
- 话筒声音盖过音乐清晰可闻
- 松开后**自动恢复**音乐音量

如果不压低，DSP Preset 里的 Priority Ducking 没启用，回去开。

### 5.4 场景联调

后台 `/admin/scenes → 测试`：

- 「开馆模式」 → 1F + 2F 背景音乐播放，音量 30%
- 「会议模式」 → 会议区音量 60%，BGM 切到 50%（防干扰会议）
- 「闭馆模式」 → 所有分区静音

---

## 6. 故障排查表

| 现象 | 检查 | 解决 |
| --- | --- | --- |
| 喇叭完全无声 | 功放 POWER 灯亮吗 / 静音开关 / 总音量 | 通电、解除静音 |
| 同上 | DSP 是否有信号输出 (DSP 面板 LED) | 厂家工具看输出电平条 |
| 同上 | 喇叭线短路 / 断路 (万用表量阻) | 重新接线 |
| 一边响一边不响 | 喇叭线某节断了 / 喇叭烧 | 沿线检查 / 换喇叭 |
| 嗡嗡底噪 | 接地不好 / 麦克线没屏蔽 | 重接地 + 换屏蔽线 |
| 啸叫 (Feedback) | 麦克音量过大 / 话筒离喇叭近 | 调低麦增益 / EQ 切窄频段衰减 / 用全指向麦 |
| 中控音量变化但喇叭不变 | DSP 接收到指令但内部静音 | DSP 面板看 OUT 通道 Mute 状态 |
| 中控连不上 DSP | adapter 协议格式不对 | 改写 `real-audio.adapter.ts` |
| 网络通但 API 404 | 端口错 / API 路径错 | 看厂家文档改 .env |
| 串台 (一区操作影响别区) | DSP 矩阵路由配错 | 厂家工具重排矩阵 |
| 麦克风按下没盖过 BGM | Priority Ducking 没启用 | DSP Preset 设置 |

---

## 7. 安全 & 验收

### 7.1 安全注意

- **功放后部温度高**，机柜散热要做好
- **定压系统 100V 不是安全电压**，断电后再接喇叭
- **+48V Phantom 电源**只给电容麦用，动圈麦不要开（可能损坏）
- 紧急广播话筒**单独留一根线**，不经过 DSP 直通功放（保证 DSP 故障也能广播）

### 7.2 交付前自检清单

| # | 项 | 检查 |
| --- | --- | --- |
| 1 | DSP IP `192.168.50.40` 可 ping | ☐ |
| 2 | 厂家工具能直接控制 DSP，喇叭出声 | ☐ |
| 3 | 中控 `runtime/gateways` 显示 `audio-dsp` `state=online` | ☐ |
| 4 | 4 个分区独立控制无串台 | ☐ |
| 5 | 每个分区音量平滑过渡 0-100% | ☐ |
| 6 | 静音 / 取消静音瞬时响应 | ☐ |
| 7 | 无线麦各 zone 切换正常 | ☐ |
| 8 | 紧急广播能盖过所有 BGM（Ducking） | ☐ |
| 9 | 各分区声压均匀度 ≤ 6dB（用声压计量） | ☐ |
| 10 | 「开馆模式」「会议模式」场景联动正常 | ☐ |
| 11 | 拔 DSP 网线 → 后端 alert `gateway_offline` | ☐ |
| 12 | DSP 恢复后 → alert 自动 resolve | ☐ |
| 13 | DSP Preset "Default" 开机自动加载 | ☐ |
| 14 | DSP Preset "Emergency" 可手动切 | ☐ |

---

## 8. 附录

### 8.1 DSPPA MAG6816 接口示意（参考）

```
前面板:
  POWER 开关 | 数显屏 | 选择键 | 输入电平 LED × 8 | 输出电平 LED × 8

后面板:
  6 路 MIC IN (XLR / 凤凰端子, 带 +48V 开关)
  2 路 LINE IN (RCA / 凤凰端子)
  8 路 OUT (凤凰端子, 平衡)
  RS-232 (DB9, 调试用)
  LAN (RJ45, 主控接口)
  USB (固件升级)
  220V 电源
```

### 8.2 与 DSPPA 厂家联系

- DSPPA 官网 https://www.dsppa.com.cn/
- 售后电话：400-680-8989（参考，以实际为准）
- 技术资料申请：让销售方提供：
  - 产品手册 PDF
  - **TCP/IP 通讯协议文档**（中控对接必需）
  - PC 控制软件（DSPPA Pro）
  - 默认 Preset 配置文件（如有）

### 8.3 相关代码位置

- `backend/src/adapters/audio/real-audio.adapter.ts` — 真实 DSP 适配器（**可能需要按实际协议改写**）
- `backend/src/adapters/audio/mock-audio.adapter.ts` — Mock 实现，演示模式用
- `backend/src/modules/audio/` — HTTP 控制器
- `frontend/src/pages/AudioPage.vue` — 平板音响控制页（4 分区）
- `frontend/src/pages/admin/TestCenterAdmin.vue` — 后台单设备测试 / 子系统测试

### 8.4 相关文档

- [DALI 灯光现场施工 SOP](DALI_FIELD_INSTALL.md) — 同款施工流程模板
- [Sprint-10 工作纪要](SESSION-2026-05-20-RECAP.md)
- [Windows 部署手册](../DEPLOY_WINDOWS.md)

### 8.5 联系方式（按需填）

- DSPPA 销售 / 售后：__________
- 功放 / 喇叭供应商：__________
- 现场弱电施工单位：__________
- 中控系统开发组：__________
- 现场调试负责人：__________

---

## 9. 应急回退

如果 DSP 出现无法解决的问题，影响展厅运营：

```powershell
# 方案 A: 临时切 MOCK 模式 (中控界面正常, 但不下发到 DSP)
# 编辑 D:\smart-control\backend\.env, 改:
MOCK_MODE=true
# 然后:
pm2 reload smart-control-backend --update-env
```

```
# 方案 B: 把 DSP 切到 Local 模式
DSP 面板按 "Local / Network" 切换键 → Local
然后用 DSP 自带前面板按键直接控制音量 / 静音 (脱离网络)
```

```
# 方案 C: 喇叭直通功放 (终极方案, 应急广播必备)
紧急广播话筒留一根线**绕过 DSP**直接接功放 INPUT 4
即使 DSP 故障, 拨开关到 Bypass 也能广播
```

---

## 10. 调试常用指令速查

```powershell
# 网络层
ping 192.168.50.40
Test-NetConnection 192.168.50.40 -Port 80

# 中控触发健康探活
curl -X POST http://localhost:3000/api/system/runtime/health/probe

# 查 audio gateway 状态
curl http://localhost:3000/api/system/runtime/gateways | ConvertFrom-Json | Select-Object -ExpandProperty data | Where-Object { $_.gateway -eq 'audio-dsp' }

# 直接调试 API (假设的, 真实协议可能不同)
curl -X PUT http://192.168.50.40/api/zones/1f_bg/volume -H "Content-Type: application/json" -d '{"value":50}'

# 后台子系统批量测试
# 打开 /admin/test-center → 子系统测试 → audio → 批量
```
