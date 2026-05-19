import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const ALERT_LEVELS = ['info', 'warning', 'critical', 'emergency'] as const;
export type AlertLevel = (typeof ALERT_LEVELS)[number];

export const ALERT_STATUSES = ['active', 'resolved', 'ignored'] as const;
export type AlertStatus = (typeof ALERT_STATUSES)[number];

@Entity({ name: 'alerts' })
export class Alert {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  level!: AlertLevel;

  /** 业务子类型 (device_offline / scene_failed / gateway_reconnect / ...) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  type!: string;

  /** 来源类别 (device / gateway / scene / scheduler / system) */
  @Index()
  @Column({ name: 'source_type', type: 'varchar', length: 32 })
  sourceType!: string;

  /** 来源 ID (设备名/网关名/sceneCode/任务id 等) */
  @Column({ name: 'source_id', type: 'varchar', length: 128, nullable: true })
  sourceId!: string | null;

  @Column({ type: 'varchar', length: 256 })
  title!: string;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16, default: 'active' })
  status!: AlertStatus;

  @Column({ name: 'resolved_at', type: 'datetime', nullable: true })
  resolvedAt!: Date | null;

  @Column({ name: 'resolved_by', type: 'varchar', length: 64, nullable: true })
  resolvedBy!: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
