import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 空调内机 (HvacIndoor) — 2026-07-16.
 *
 * 为什么要有这张表:
 *   之前只有 hvac_zone, 分区成员 (indoors: [1,2,3]) 是从代码常量 HVAC_ZONES
 *   灌进去就锁死的 —— 前端只能改区名, 改不了"这个区里到底是哪几台内机", 也建
 *   不了新区。而现场的实际情况是: 分区图纸本来就跟现场对不上, 所以"能改名但改
 *   不了成员"等于没用 —— 给一个内容错误的盒子换标签而已。业主原话:
 *   "根本就不可能实现, 也没法操作, 除了在代码改, 别的地方都无法改"。
 *
 * 所以把关系倒过来: **内机是一等公民, 组只是内机的一个属性**.
 *   - 内机有自己的名字 → 单机测试时能认出哪台是哪台 (开一台看哪个房间凉)
 *   - 归属靠 zoneCode 一个字段 → "把内机划进某组" 就是改个字段, 建组/删组/
 *     改组名都是普通 CRUD, 全在前端完成
 *   - zoneCode 为 null = 未分组, 前端单独归到"未分组"里显示, 不会丢
 *   对比原来的 hvac_zone.indoors JSON 数组: 那种存法要维护双向一致 (一台内机
 *   被写进两个区怎么办?), 而 zoneCode 天然保证一台内机只属于一个区.
 *
 * idx 是什么:
 *   "楼层内机序号" 1..22 (1F=1-10, 2F=11-22), 跟 HVAC_ZONES / 场景动作 / 前端
 *   下发的口径完全一致。它 **不是** 网关上的物理内机号 n (1F n=1..10 / 2F
 *   n=1..12) —— 序号→{gwHost,n} 的换算由 ModbusHvacAdapter.listIndoorMeta()
 *   查 devices 表完成, 那里是唯一的排序口径 (2026-07-11 踩过内机号错位的坑,
 *   两处各排一次序必然漂移)。
 *
 * 这张表只存**展示/编组元数据**, 不存地址 —— 地址的唯一真源仍是 devices.address,
 * 网关换 IP 时那边会联动, 这里不该跟着复制一份。
 */
@Entity({ name: 'hvac_indoor' })
export class HvacIndoor {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 楼层内机序号 1..22 — 前端/场景下发用的就是它 */
  @Index({ unique: true })
  @Column({ type: 'integer' })
  idx!: number;

  /** 显示名 — 业主在 PWA 直接改. 默认 '1F-01' 这种物理定位名, 现场测出来再改成房间名 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 楼层 '1F' / '2F' */
  @Column({ type: 'varchar', length: 16 })
  floor!: string;

  /** 归属功能区 code (对应 hvac_zone.code); null = 未分组 */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'zone_code', nullable: true })
  zoneCode!: string | null;

  /** 机型 e.g. 'DLR-63F' — 灌种子时从 devices.address 抄一份, 仅供显示 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  model!: string | null;

  /** 显示顺序 (升序), 默认跟 idx 一致 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 启用 (禁用后前端不显示, 保留历史数据) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
