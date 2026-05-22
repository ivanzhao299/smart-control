import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 硬件清单 (Hardware Unit)
 *
 * 与 `device` 表的区别:
 *   - `device`        = 中控可调度的"逻辑设备" (灯光分区, LED 大屏, 空调机组), 是 API 抽象
 *   - `hardware_unit` = 现场物理硬件 (DALI 网关, 调光器, NUC 播控主机, RTU/TCP 转换器),
 *                       记录型号 / 序列号 / 安装位置 / 接线, 给运维定位故障用
 *
 * 同一台 led-driver / dali-converter (4 通道) 可能对应多个 device (一通道一个 zone),
 * 反过来同一个 device (e.g. "1F 前厅灯带" zone) 也可能由多台并联驱动器共同驱动 (走廊 130m 拆 3 台).
 * 所以两者是多对多关系, 这里只保存 hardware 自身信息, 关联在 channels JSON 里描述.
 *
 * DALI 架构 (2026-05-21 方案 B):
 *   PC backend → RS485↔TCP (USR-TCP232) → DALI 网关/调光控制器 (CY-DALI64A)
 *     → DALI 总线 (2 线)
 *       ├── LED 灯具驱动器 (明纬 HLG-XXH-24DA × 14, led-driver) → LED 灯带
 *       └── DALI→0-10V 转换器 (雷特 LT-84A × 3, dali-converter) → 灯具自带 0-10V 驱动 → 筒灯/射灯
 *   网关本身就是调光器 (发 DALI dim 命令), 下游驱动器是 DALI-addressable 的 LED 电源.
 *   不存在"中间 DALI 调光器模块" (旧方案的 DA4-D 已废弃).
 */

export const HARDWARE_CATEGORIES = [
  'dali-gateway',     // DALI 网关/调光控制器 (CY-DALI64A — 发 DALI 命令, 它本身就是调光器)
  'led-driver',       // LED 灯具驱动器 (明纬 HLG-XXH-24DA 自带 DALI 接收, 直接挂 DALI 总线驱动灯带)
  'dali-converter',   // DALI ↔ 0-10V 信号转换器 (雷特 LT-84A — DALI 总线信号转 0-10V 给下游灯具)
  'dali-dimmer',      // [废弃] DALI 调光器模块 (DA4-D 等中间模块, 2026-05-21 方案 B 后不再使用; 保留枚举防数据库报错)
  'rtu-tcp-converter',// RS-485 RTU ↔ TCP 转换器 (USR-TCP232, Moxa MGate)
  'led-controller',   // LED 大屏控制器 (诺瓦 VX1000)
  'led-player',       // LED 播控主机 (Intel NUC)
  'audio-dsp',        // 音响 DSP (得胜 EKX-808 / DSPPA / ITC)
  'audio-guide',      // 智能分区导览 / 跟随讲解 (得胜 WTG-800 等)
  'audio-power',      // 音响电源时序器 (得胜 EPO-802P 等)
  'hvac-outdoor',     // 中央空调外机 (商用 VRF, 例如 奥克斯 DLR-735W5)
  'hvac-gateway',     // 中央空调通讯网关 (例如 奥克斯 CCM-270B)
  'power-relay',      // 强电继电器模块
  'tablet',           // 控制平板
  'switch',           // 网络交换机
  'router',           // 路由器
  'ups',              // 不间断电源
  'other',            // 其它
] as const;
export type HardwareCategory = (typeof HARDWARE_CATEGORIES)[number];

export type HardwareStatus = 'normal' | 'fault' | 'offline' | 'maintenance' | 'retired';

@Entity({ name: 'hardware_units' })
export class HardwareUnit {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 现场编号 (e.g. "DA4D-001", "GW-DALI-1"), 全局唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  /** 显示名 (e.g. "1F 前厅调光器") */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  category!: HardwareCategory;

  /** 厂商 (e.g. "元创智控", "CTLEDTECH", "诺瓦") */
  @Column({ type: 'varchar', length: 64 })
  vendor!: string;

  /** 型号 (e.g. "CY-DALI64A", "HLG-480H-24DA", "LT-84A") */
  @Column({ type: 'varchar', length: 64 })
  model!: string;

  /** 序列号 / SN */
  @Column({ type: 'varchar', length: 128, nullable: true })
  serialNo!: string | null;

  /** 固件版本 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  firmwareVersion!: string | null;

  /** 安装位置 (e.g. "1F 电箱 F101 内", "2F 配房机柜 A3") */
  @Column({ type: 'varchar', length: 128, nullable: true })
  location!: string | null;

  /** 楼层 1F/2F/... 用于按楼层筛选 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  floor!: string | null;

  /** IP 地址 (有些硬件走 TCP/IP) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  /** MAC 地址 */
  @Column({ type: 'varchar', length: 32, nullable: true })
  macAddress!: string | null;

  /**
   * 协议寻址 JSON, 由 category 决定字段:
   *   dali-gateway:   {"slaveId":1}  (Modbus RTU 拨码盘地址)
   *   led-driver:     {"daliShort":1,"watt":480,"voltage":24}  (DALI 短地址 + 额定功率 + 输出电压)
   *   dali-converter: {"daliStart":14,"channels":4}  (起始短地址 + 4 路 0-10V 输出)
   *   rtu-tcp-converter: {"port":502,"baud":9600}
   *   led-controller: {"box":"1","port":1}
   *   audio-dsp:      {"zones":["1f_bg","2f_bg"]}
   *   hvac-gateway:   {"slaveId":1,"port":502}
   */
  @Column({ type: 'text', nullable: true })
  addressing!: string | null;

  /**
   * 通道清单 JSON (主要给 LT-84A 类多通道 0-10V 转换器), 描述每个通道接什么:
   *   [
   *     { "ch":1, "daliShort":1, "label":"前厅筒灯",   "powerW":80,  "linkDeviceId":12 },
   *     { "ch":2, "daliShort":2, "label":"前厅射灯",   "powerW":100, "linkDeviceId":12 },
   *     ...
   *   ]
   * linkDeviceId 可选, 关联回 device 表的逻辑设备
   */
  @Column({ type: 'text', nullable: true })
  channels!: string | null;

  /** 状态 */
  @Column({ type: 'varchar', length: 16, default: 'normal' })
  status!: HardwareStatus;

  /** 启用标志 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** 备注 (排故记录、配置历史等) */
  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /** 安装日期 (ISO 字符串) */
  @Column({ type: 'varchar', length: 32, nullable: true })
  installedAt!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
