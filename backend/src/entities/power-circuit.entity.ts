import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 电源回路 (PowerCircuit) — Sprint G (2026-05-31).
 *
 * 每条回路 = 一个总开关 (强电继电器某通道) + 一个电能表的某地址(可选).
 *   - 通断控制: 走 hardware_unit.code 对应的 power-relay 设备, relayChannel 指定该
 *     继电器的第几路 (大多数 4/8/16 路继电器).
 *   - 数据采集: meterAddress 指定 Modbus 电能表的从机地址 (DTS634 / DDS866 等),
 *     没装电表就填 null, adapter 走 mock 用额定参数模拟.
 *
 * 业务字段:
 *   - category: lighting / socket / hvac / led / audio / misc (展厅常见 6 类用电)
 *   - rated*: 额定电压 (220V) / 电流 (16A 居多) / 功率 (W), 用于校验和 mock 模拟
 *
 * 跟其他实体的关系:
 *   - PowerCircuit 不直接关联 light_zone — 一个电源回路通常对应多个分区/设备.
 *     现场要看哪盏灯靠哪路供电, 走施工图, 系统里不强行建模, 避免数据洁癖.
 */
@Entity({ name: 'power_circuit' })
export class PowerCircuit {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 业务编码 e.g. '1f-main', '1f-lighting', '2f-hvac', 唯一. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  /** 显示名 e.g. '一层总闸', '二层空调回路' */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 楼层 tag */
  @Column({ type: 'varchar', length: 16 })
  floor!: string;

  /** 类型 — 用于前端分组和默认图标 */
  @Column({ type: 'varchar', length: 32, default: 'misc' })
  category!: string;

  /** 关联的继电器硬件 code (对应 hardware_unit.code, category=power-relay) */
  @Column({ type: 'varchar', length: 64, name: 'gateway_code', nullable: true })
  gatewayCode!: string | null;

  /** 继电器通道号 1-N */
  @Column({ type: 'integer', name: 'relay_channel', nullable: true })
  relayChannel!: number | null;

  /** 电能表 Modbus 地址 (可选), null = 没装电表, 走 mock 数据 */
  @Column({ type: 'integer', name: 'meter_address', nullable: true })
  meterAddress!: number | null;

  /** 额定电压 V (默认 220) */
  @Column({ type: 'integer', name: 'rated_voltage', default: 220 })
  ratedVoltage!: number;

  /** 额定电流 A (默认 16) */
  @Column({ type: 'integer', name: 'rated_current', default: 16 })
  ratedCurrent!: number;

  /** 额定功率 W (默认 0 = 未填, mock 时按电压×电流估算) */
  @Column({ type: 'integer', name: 'rated_power', default: 0 })
  ratedPower!: number;

  /** 显示顺序 (升序), 默认 100 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** lucide 图标 key */
  @Column({ type: 'varchar', length: 32, nullable: true })
  icon!: string | null;

  /** 备注 */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** 启用 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
