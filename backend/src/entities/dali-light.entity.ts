import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 单盏 DALI 灯 (软件视角) — 2026-07-21。
 *
 * 【只在软件里维护对应关系, 不往灯里写任何东西】
 * DALI 灯具本身只有一个网关分配的短地址 (1-64)。厂家软件那套"把名字/分组烧进灯"
 * 我们不碰。这张表就是**短地址 ↔ 名称 ↔ 归属分区**的软件映射:
 *   - 扫描: 读网关在线矩阵, 发现哪些短地址在线 → upsert 一行(新灯自动出现)
 *   - 命名: 现场点灯闪烁认位置 → 给这行填 name (纯软件, 灯毫不知情)
 *   - 分组: 填 zoneCode 归到某个分区 (light_zone.code)
 *   - 控制: 控分区 = 遍历该分区下所有灯的短地址逐盏直控(不依赖 DALI 硬件组)
 *
 * 唯一标识是 (gatewayCode, shortAddr): 短地址在网关间会重复(网关1和网关2各有
 * 自己的 1-64), 必须带上是哪个网关。gatewayCode 对应 hardware_unit.code。
 */
@Entity({ name: 'dali_light' })
@Unique('uq_dali_light_gw_short', ['gatewayCode', 'shortAddr'])
export class DaliLight {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 所在网关 code (对应 hardware_unit.code), e.g. 'GW-DALI-1' */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'gateway_code' })
  gatewayCode!: string;

  /** DALI 短地址 1-64 */
  @Column({ type: 'integer', name: 'short_addr' })
  shortAddr!: number;

  /** 软件命名 (现场认灯后填); null = 还没命名, 前端用短地址占位显示 */
  @Column({ type: 'varchar', length: 128, nullable: true })
  name!: string | null;

  /** 归属分区 code (对应 light_zone.code); null = 未分配, 前端单独列出 */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'zone_code', nullable: true })
  zoneCode!: string | null;

  /** 最后一次扫描/探测到的在线状态 */
  @Column({ type: 'boolean', default: false })
  online!: boolean;

  /** 最后一次探测到的故障状态 (1=故障) */
  @Column({ type: 'boolean', default: false })
  fault!: boolean;

  /** 最后一次被扫描/探测到的时刻 */
  @Column({ type: 'datetime', name: 'last_seen_at', nullable: true })
  lastSeenAt!: Date | null;

  /** 分区内显示顺序 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 启用 (禁用后前端不显示, 保留命名/分组历史) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
