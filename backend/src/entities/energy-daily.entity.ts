import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 回路按日用电量 (EnergyDaily) — 能源管理 (2026-10-05).
 *
 * 每条 = 某电源回路在某一天 (date, YYYY-MM-DD) 的用电量 kWh。
 *   - source='cloud'   : 云断路器 (华普云 /app/device/device-total) 的平台电表读数,
 *                        权威值, 采集时 upsert 覆盖。
 *   - source='integral': 平台无电量上报的回路 (485/MQTT/时序器等), 由后端对
 *                        瞬时功率做时间积分得到, 作为兜底口径。
 *
 * 用 circuit_code (业务编码) 而非自增 id 关联回路, 跨站点/迁移更稳; (circuit_code,date)
 * 唯一, 重复采集幂等。总累计 / 今日 / 本月均由本表按日期聚合得到, 不另存总量。
 */
@Entity({ name: 'energy_daily' })
@Index('uq_energy_daily_circuit_date', ['circuitCode', 'date'], { unique: true })
export class EnergyDaily {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 回路业务编码 (对应 power_circuit.code) */
  @Column({ type: 'varchar', length: 64, name: 'circuit_code' })
  circuitCode!: string;

  /** 回路自增 id (冗余, 便于 join/排查; 可空) */
  @Column({ type: 'integer', name: 'circuit_id', nullable: true })
  circuitId!: number | null;

  /** 日期 YYYY-MM-DD */
  @Column({ type: 'varchar', length: 10 })
  date!: string;

  /** 当日用电量 kWh */
  @Column({ type: 'double precision', name: 'kwh', default: 0 })
  kwh!: number;

  /** 数据来源: cloud=平台电表 / integral=功率积分 */
  @Column({ type: 'varchar', length: 16, default: 'integral' })
  source!: string;

  /** 当日峰值功率 W (可选, 用于负荷分析) */
  @Column({ type: 'double precision', name: 'peak_power', nullable: true })
  peakPower!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
