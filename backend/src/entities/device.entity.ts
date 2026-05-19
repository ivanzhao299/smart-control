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

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
