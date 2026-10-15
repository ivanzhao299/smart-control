import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * em123 表计按小时抄表记录 (Em123Hourly) — 智慧能源管理平台 (2026-10-15).
 *
 * 每条 = 某块表在某一整点时刻 (readingTime) 的定时抄表记录 (readingType=0, 平台每小时一条):
 *   - readingValue: 原始字轮读数(未乘倍率)。
 *   - hourUse:      本次抄表间隔(约 1 小时)的用量, 平台已乘倍率 (电 kWh); 即该小时用电量。
 *   - hourAvgKw:    该小时平均功率 (kW) = hourUse / 实际间隔小时数, 定时记录间隔≈1h。
 *   - csq:          信号强度。
 *
 * 用途: 对三相关口总表, 用 24 条小时记录还原真实负荷曲线/峰值/平均,
 * 把运营大屏变压器面板从"按面积估算"升级为"小时级实测", 无需新增硬件。
 * (meter_no, reading_time) 唯一, 重复采集幂等; 只存定时抄表, 不存手动实时召测。
 */
@Entity({ name: 'em123_hourly' })
@Index('ix_em123_hourly_type_time', ['meterType', 'readingTime'])
export class Em123Hourly {
  /** 表号 (对应 em123_meter.meter_no), 与 readingTime 组成复合主键 */
  @PrimaryColumn({ type: 'varchar', length: 64, name: 'meter_no' })
  meterNo!: string;

  /** 表类型: E=电(kWh) / W=水(t) */
  @Column({ type: 'varchar', length: 2, name: 'meter_type' })
  meterType!: string;

  /** 抄表时刻 YYYY-MM-DD HH:MM:SS (定时记录, 每小时一条), 与 meterNo 组成复合主键 */
  @PrimaryColumn({ type: 'varchar', length: 20, name: 'reading_time' })
  readingTime!: string;

  /** 本次字轮读数 (原始, 未乘倍率) */
  @Column({ type: 'double precision', name: 'reading_value', default: 0 })
  readingValue!: number;

  /** 该小时用量 (已乘倍率, 电 kWh / 水 t) */
  @Column({ type: 'double precision', name: 'hour_use', default: 0 })
  hourUse!: number;

  /** 该小时平均功率 (kW, 电); 水表为 0 */
  @Column({ type: 'double precision', name: 'hour_avg_kw', default: 0 })
  hourAvgKw!: number;

  /** 该小时费用 (元) */
  @Column({ type: 'double precision', name: 'use_money', default: 0 })
  useMoney!: number;

  /** 信号强度 (dBm) */
  @Column({ type: 'varchar', length: 8, name: 'csq', nullable: true })
  csq!: string | null;

  /** 抄表类型: 0=定时 / 1=手动召测 */
  @Column({ type: 'varchar', length: 2, name: 'reading_type', default: '0' })
  readingType!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
