import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 电源域 (PowerDomain) — 2026-10-17 第五轮「开关域划分」。
 *
 * 域 = 可授权的顶层区域范围（展厅 / 园区 / 未来新增楼栋）。
 * 一条电源回路 (PowerCircuit) 挂且仅挂一个域；域内再用 floor 区分楼层/位置
 * （1F / 2F / 音响 / 园区……）。角色 × 域 的写/读授权矩阵见 common/auth/rbac.ts，
 * 让展厅操作员只动展厅、运营配置员只动园区，从根上避免跨区误触全场断电。
 *
 * 扩展性：新增楼栋/区域 = 管理员在后台「电源域」新建一条域（code + 名称），
 * 再在回路登记里选所属域即可，无需改代码。新域默认只归 admin 操作（见 rbac.ts）。
 */
@Entity({ name: 'power_domain' })
export class PowerDomain {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 业务编码（英文 kebab），唯一，如 'hall' / 'park' / 'building-b'。 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  code!: string;

  /** 中文显示名，如 '展厅' / '园区' / 'B 栋'。 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 显示顺序（升序），默认 100。 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 备注（该域范围说明，可空）。 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  /** 是否启用（禁用后该域不允许再挂新回路，历史回路只读）。 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
