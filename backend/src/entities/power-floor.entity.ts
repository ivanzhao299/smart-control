import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 电源分区 (PowerFloor) — 2026-10-18「分区（楼层）二级管理」。
 *
 * 层级：电源域 PowerDomain（展贸中心/园区，可授权的一级区域）
 *       └─ 电源分区 PowerFloor（域内的楼层/位置/设备组，如 1F / 二台时序 / 时序器）
 *            └─ 电源回路 PowerCircuit（具体开关回路）。
 *
 * 设计要点（code / 中文名分离）：
 *  - 回路 power_circuit.floor 存的是分区的稳定 code（列名/列结构保持不变，零改数据），
 *    tab 与卡片显示中文名 name。
 *  - 改名只改本表 name，回路 code 不动 → 整层一次性跟随、永不分裂出新 tab；
 *  - 历史分区 code 直接取迁移前的 floor 中文值（"1F"/"二台时序"），name 同值；
 *    新建分区 code 由后端自动生成，用户只需填中文名。
 *
 * 唯一约束：同一域内 code 唯一、name 不允许重名（service 层校验）。
 * 分区不单独做角色授权，跟随所属域的「角色 × 域」三态权限。
 */
@Entity({ name: 'power_floor' })
@Index('idx_power_floor_domain_code', ['domainCode', 'code'], { unique: true })
export class PowerFloor {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 所属电源域 code（PowerDomain.code），如 hall / park。 */
  @Column({ type: 'varchar', length: 32, name: 'domain_code' })
  domainCode!: string;

  /** 分区稳定标识（域内唯一）；回路引用它。历史值=原 floor 中文，新值系统自动生成。 */
  @Column({ type: 'varchar', length: 48 })
  code!: string;

  /** 中文显示名，如 1F / 二台时序 / 时序器（改名只改这里）。 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 显示顺序（升序），默认 100。 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 是否启用（停用后不再出现在回路归属与分区 tab，历史回路只读）。 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
