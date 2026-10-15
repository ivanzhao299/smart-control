import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * em123 表计按日用量 (Em123Daily) — 智慧能源管理平台 (2026-10-14).
 *
 * 每条 = 某块表在某一天 (date, YYYY-MM-DD) 的用量。
 *   - meterType: 'E'=电表(单位 kWh) / 'W'=水表(单位 t)。
 *   - useLimit:  当日用量, 平台已乘倍率, 权威值, 直接聚合使用。
 *   - useMoney:  当日费用(元)。
 *   - startValue/endValue: 当日起/止字轮读数(minValue/maxValue)。
 *
 * (meter_no,date) 唯一, 重复采集幂等; 总累计/今日/本月/趋势均由本表按日期聚合。
 */
@Entity({ name: 'em123_daily' })
@Index('ix_em123_daily_type_date', ['meterType', 'date'])
export class Em123Daily {
  /** 表号 (对应 em123_meter.meter_no), 与 date 组成复合主键 */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'meter_no' })
  meterNo!: string;

  /** 表类型: E=电(kWh) / W=水(t) */
  @Column({ type: 'varchar', length: 2, name: 'meter_type' })
  meterType!: string;

  /** 日期 YYYY-MM-DD, 与 meterNo 组成复合主键 */
  @PrimaryColumn({ type: 'varchar', length: 10 })
  date!: string;

  /** 当日用量 (电 kWh / 水 t, 平台已乘倍率) */
  @Column({ type: 'double precision', name: 'use_limit', default: 0 })
  useLimit!: number;

  /** 当日费用 (元) */
  @Column({ type: 'double precision', name: 'use_money', default: 0 })
  useMoney!: number;

  /** 当日起读数(原始字轮) */
  @Column({ type: 'double precision', name: 'start_value', nullable: true })
  startValue!: number | null;

  /** 当日止读数(原始字轮) */
  @Column({ type: 'double precision', name: 'end_value', nullable: true })
  endValue!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
