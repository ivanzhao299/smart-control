import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const DEVICE_CATEGORIES = ['lighting', 'led', 'audio', 'hvac', 'power', 'system'] as const;
export type DeviceCategory = (typeof DEVICE_CATEGORIES)[number];

export const DEVICE_STATUSES = [
  'online',
  'offline',
  'reconnecting',
  'running',
  'error',
  'disabled',
] as const;
export type DeviceStatus = (typeof DEVICE_STATUSES)[number];

@Entity({ name: 'devices' })
export class Device {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  category!: DeviceCategory;

  @Column({ type: 'varchar', length: 64, default: 'tcp' })
  protocol!: string;

  @Column({ type: 'varchar', length: 64, default: 'mock' })
  adapter!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  ip!: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  address!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  floor!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  zone!: string | null;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'offline' })
  status!: DeviceStatus;

  /** Sprint-09: 调试备注 (工程师手填, 排查时存放厂家版本/接线说明等) */
  @Column({ name: 'debug_remark', type: 'text', nullable: true })
  debugRemark!: string | null;

  @Column({ name: 'last_test_at', type: 'datetime', nullable: true })
  lastTestAt!: Date | null;

  /** Sprint-09: 最近一次测试结果 (success / failure / 错误描述截断) */
  @Column({ name: 'last_test_result', type: 'varchar', length: 256, nullable: true })
  lastTestResult!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
