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
 * 同一台 DA4-D 调光器可能对应多个 device (4 个通道接 4 路灯, 每路一个 zone),
 * 反过来同一个 device (e.g. "1F 前厅灯光" zone) 也可能由多台调光器共同驱动.
 * 所以两者是多对多关系, 这里只保存 hardware 自身信息, 关联在 channels JSON 里描述.
 */

export const HARDWARE_CATEGORIES = [
  'dali-gateway',     // DALI 网关 (CY-DALI64A 等)
  'dali-dimmer',      // DALI 调光器 (DA4-D 等)
  'rtu-tcp-converter',// RS-485 RTU ↔ TCP 转换器 (USR-TCP232, Moxa MGate)
  'led-controller',   // LED 大屏控制器 (诺瓦 VX1000)
  'led-player',       // LED 播控主机 (Intel NUC)
  'audio-dsp',        // 音响 DSP (DSPPA / ITC)
  'hvac-gateway',     // 中央空调通讯网关
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

  /** 型号 (e.g. "CY-DALI64A", "DA4-D") */
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
   *   dali-dimmer:    {"daliStart":1,"daliCount":4}  (起始短地址 + 通道数)
   *   rtu-tcp-converter: {"port":502,"baud":9600}
   *   led-controller: {"box":"1","port":1}
   *   audio-dsp:      {"zones":["1f_bg","2f_bg"]}
   *   hvac-gateway:   {"slaveId":1,"port":502}
   */
  @Column({ type: 'text', nullable: true })
  addressing!: string | null;

  /**
   * 通道清单 JSON (主要给 DA4-D 类多通道调光器), 描述每个通道接什么:
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
