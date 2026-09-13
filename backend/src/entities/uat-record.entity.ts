import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export const UAT_STATUSES = ['pending', 'passed', 'failed', 'need_adjustment'] as const;
export type UatStatus = (typeof UAT_STATUSES)[number];

export const UAT_CATEGORIES = ['scene', 'device', 'stability', 'other'] as const;
export type UatCategory = (typeof UAT_CATEGORIES)[number];

@Entity({ name: 'uat_records' })
export class UatRecord {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'item_name', type: 'varchar', length: 128 })
  itemName!: string;

  @Index()
  @Column({ type: 'varchar', length: 32 })
  category!: UatCategory;

  @Column({ name: 'test_step', type: 'text', nullable: true })
  testStep!: string | null;

  @Column({ name: 'expected_result', type: 'text', nullable: true })
  expectedResult!: string | null;

  @Column({ name: 'actual_result', type: 'text', nullable: true })
  actualResult!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: UatStatus;

  @Column({ type: 'varchar', length: 64, nullable: true })
  tester!: string | null;

  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /** 排序号 (前端展示用) */
  @Column({ name: 'sort_order', type: 'int', default: 0 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
