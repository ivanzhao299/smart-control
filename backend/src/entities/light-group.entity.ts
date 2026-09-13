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
 * 一个物理 DALI 组 (LightGroup) — 2026-07-16.
 *
 * 为什么要有这张表:
 *   原来 light_zone 上直接挂 (gatewayCode, daliGroup) 两个字段, 等于**一个分区
 *   只能对应一个组**。而现场实际是 7 个分区、11 个组 —— 好几个分区由多组灯拼成
 *   (业主原话: "有的多组灯放在一个分区")。单值字段表达不了, 硬塞就得给同一个
 *   分区建多条 zone 记录, 前端会显示成多个重复分区。
 *
 * 所以照 hvac_indoor 的做法把关系倒过来: **组是一等公民, 分区只是个名字**,
 * 归属靠组身上的 zoneCode。好处跟空调那次一样:
 *   - 一个分区含几个组都行, 加减组只是改一个字段
 *   - zoneCode 天然保证一个组只属于一个分区 (不会两边都写、对不上)
 *   - zoneCode 为 null = 未分配, 前端单独列出来, 不会凭空消失
 *   - 全部可在前端改 —— 业主明确要求 "后续可以在测试时再修改"
 *
 * 组号会在网关间重复:
 *   网关1 和网关2 各有自己的 DALI 总线, 两边都可能有 "组 3", 但那是**物理上完全
 *   不同的灯**。所以唯一键是 (gatewayCode, daliGroup) 两个一起, 不能只用组号。
 *
 * 这张表只存**归属/展示**元数据; 组号→网关 slaveId 的换算仍走 hardware_unit
 * 的 addressing.slaveId, 那里是地址的唯一真源。
 */
@Entity({ name: 'light_group' })
@Unique('uq_light_group_gw_group', ['gatewayCode', 'daliGroup'])
export class LightGroup {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 所在网关 code (对应 hardware_unit.code), e.g. 'GW-DALI-1' / 'GW-DALI-2' */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'gateway_code' })
  gatewayCode!: string;

  /** 该网关上的 DALI 组号 1-16 */
  @Column({ type: 'integer', name: 'dali_group' })
  daliGroup!: number;

  /** 归属分区 code (对应 light_zone.code); null = 未分配 */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'zone_code', nullable: true })
  zoneCode!: string | null;

  /**
   * 该组实际包含的灯具短地址 JSON 数组, e.g. "[4,36,38]".
   * 现场实测填入 (逐组微调亮度→回读哪些灯跟着变), 仅供排查/展示, 控制不依赖它。
   * null = 还没扫过。
   */
  @Column({ type: 'text', nullable: true })
  shorts!: string | null;

  /** 显示顺序 (升序) */
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
