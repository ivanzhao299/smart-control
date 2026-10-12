import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 过车记录 (相机 AlarmInfoPlate 识别结果推送, 落库一行)。
 *
 * plateid 为相机对单次识别结果分配的唯一 ID, 断线重传会复用同一 plateid,
 * 故对其建唯一索引做幂等去重 (重传/重发不重复落库)。
 */
@Entity({ name: 'lpr_pass_record' })
export class LprPassRecord {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 相机单次识别结果唯一 ID (断线重传去重键) */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, name: 'plate_id' })
  plateId!: string;

  /** 设备序列号 */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  serialno!: string;

  @Column({ type: 'integer', nullable: true })
  channel!: number | null;

  /** 车牌号 */
  @Index()
  @Column({ type: 'varchar', length: 32 })
  license!: string;

  /** 车牌类型码 (见 lpr-codes PLATE_TYPE) */
  @Column({ type: 'integer', name: 'plate_type', nullable: true })
  plateType!: number | null;

  /** 车牌颜色码 (PLATE_COLOR) */
  @Column({ type: 'integer', name: 'plate_color', nullable: true })
  plateColor!: number | null;

  /** 车身颜色码 (CAR_COLOR) */
  @Column({ type: 'integer', name: 'car_color', nullable: true })
  carColor!: number | null;

  /** 车辆类型码 (CAR_TYPE, 0x00 轿车 / 0x01 SUV / 0x02 MPV) */
  @Column({ type: 'integer', name: 'car_type', nullable: true })
  carType!: number | null;

  /** 车辆品牌 (含年款时取 brand 字段) */
  @Column({ type: 'varchar', length: 64, nullable: true })
  brand!: string | null;

  /** 运动方向码 (DIRECTION) */
  @Column({ type: 'integer', nullable: true })
  direction!: number | null;

  /** 识别可信度 1..100 */
  @Column({ type: 'integer', nullable: true })
  confidence!: number | null;

  /** 触发类型码 (TRIGGER_TYPE) */
  @Column({ type: 'integer', name: 'trigger_type', nullable: true })
  triggerType!: number | null;

  /** 是否伪牌: 0 真 / 1 伪 / -1 未启用 */
  @Column({ type: 'integer', name: 'is_fake', nullable: true })
  isFake!: number | null;

  /** 是否危险车牌: 0 否 / 1 是 / -1 未启用 */
  @Column({ type: 'integer', name: 'is_danger', nullable: true })
  isDanger!: number | null;

  /** 是否离线补传: 0 在线实时 / 1 离线缓存补传 */
  @Column({ type: 'integer', default: 0 })
  isoffline!: number;

  /** 本次通行方向: in 进园 / out 出园 (按设备通道配置或方向码推断) */
  @Column({ type: 'varchar', length: 8, name: 'pass_direction', nullable: true })
  passDirection!: 'in' | 'out' | null;

  /** 放行结果: auto 白名单自动 / manual 手动开闸 / deny 黑名单拒绝 / none 未放行 */
  @Column({ type: 'varchar', length: 16, name: 'release_result', default: 'none' })
  releaseResult!: string;

  /** 抓拍小图 (车牌区域) 存储相对路径 */
  @Column({ type: 'varchar', length: 255, name: 'pic_small', nullable: true })
  picSmall!: string | null;

  /** 抓拍大图 (整车) 存储相对路径, 可选 */
  @Column({ type: 'varchar', length: 255, name: 'pic_big', nullable: true })
  picBig!: string | null;

  /** 相机识别时间 (报文 timeStamp) */
  @Index()
  @Column({ type: 'datetime', name: 'event_time', nullable: true })
  eventTime!: Date | null;

  /** 原始报文 JSON (裁剪后), 排查用 */
  @Column({ type: 'text', nullable: true })
  raw!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
