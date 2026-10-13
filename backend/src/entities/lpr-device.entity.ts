import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 臻识车牌识别一体机 (LPR 相机 / 道闸通道)。
 *
 * 一台相机 = 一个出入口通道 (X2 拼接机可用 channel 区分多路)。
 * 相机经 HTTP 推送 / comet 与后端通讯, serialno 为设备全局唯一编号,
 * 同时作为 webhook 身份白名单与 comet 命令队列的键。
 */
@Entity({ name: 'lpr_device' })
export class LprDevice {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 设备序列号 (报文 serialno), 全局唯一, 兼作 webhook 身份校验白名单 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  serialno!: string;

  /** 显示名, 如 "东门入口" */
  @Column({ type: 'varchar', length: 128, name: 'device_name' })
  deviceName!: string;

  /** 型号, 如 R5 / R5D / X2 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model!: string | null;

  /** 相机局域网 IP */
  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  /** 通道号 (单相机默认 1; X2 拼接多路时区分) */
  @Column({ type: 'integer', nullable: true })
  channel!: number | null;

  /** 安装位置 / 出入口名称 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  location!: string | null;

  /** 开闸(抬杆)使用的 IO 编号 (HTTP 回复 channelNum / ioout, 0..3), 默认 0 */
  @Column({ type: 'integer', name: 'gate_io', default: 0 })
  gateIo!: number;

  /**
   * 关闸(落杆)使用的 IO 编号 (0..3)。可空: null 表示该通道未配置远程关闸
   * (单路开闸、靠地感自动落杆的道闸无需配置)。远程关闸走 ivs_ioctrl 对该 IO
   * 发"先通后断"脉冲(协议 3.7.7); 具体编号由现场道闸"落杆"端子接线决定。
   */
  @Column({ type: 'integer', name: 'close_gate_io', nullable: true })
  closeGateIo!: number | null;

  /**
   * 软件指令态道闸状态 (GPIO 开关量道闸无真实杆位反馈时使用):
   * 1=最近一次指令为开闸(抬杆), 0=最近一次指令为关闸(落杆), null=从未远程操作过。
   * 每次远程开/关指令成功入队或投递时写入; 仅在相机未上报真实 gate_status 时用于展示。
   */
  @Column({ type: 'integer', name: 'commanded_gate', nullable: true })
  commandedGate!: number | null;

  /** 最近一次远程开/关指令时间 */
  @Column({ type: 'datetime', name: 'commanded_gate_at', nullable: true })
  commandedGateAt!: Date | null;

  /** 该通道方向: in=入口(进园) / out=出口(出园), 用于进出统计; null=未配置 */
  @Column({ type: 'varchar', length: 8, name: 'pass_direction', nullable: true })
  passDirection!: 'in' | 'out' | null;

  /** 在线状态 (由心跳 / comet 刷新) */
  @Column({ type: 'boolean', default: false })
  online!: boolean;

  /** 最后一次心跳 / 通讯时间 */
  @Column({ type: 'datetime', name: 'last_heartbeat', nullable: true })
  lastHeartbeat!: Date | null;

  /** 相机 web 管理后台账号 (仅园区内网登录, 臻识默认 admin) */
  @Column({ type: 'varchar', length: 64, name: 'web_user', nullable: true, default: 'admin' })
  webUser!: string | null;

  /** 相机 web 管理后台口令 (仅管理员接口回显; 公开 devices 接口剥离) */
  @Column({ type: 'varchar', length: 128, name: 'web_password', nullable: true, default: 'admin' })
  webPassword!: string | null;

  /**
   * 相机 web 管理后台完整地址 (可空)。为空时后端按 ip + model 推导:
   * XLT 新 vant SPA -> http://<ip>/pc/#/login; 其它 -> http://<ip>/。
   */
  @Column({ type: 'varchar', length: 255, name: 'web_url', nullable: true })
  webUrl!: string | null;

  /** 相机参数 JSON (图片大小策略、comet、SSL 等), 可选 */
  @Column({ type: 'text', nullable: true })
  config!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
