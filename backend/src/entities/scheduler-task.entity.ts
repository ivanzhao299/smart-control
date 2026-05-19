import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity({ name: 'scheduler_tasks' })
export class SchedulerTask {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  @Column({ type: 'text', nullable: true })
  description!: string | null;

  @Column({ type: 'varchar', length: 64 })
  cron!: string;

  @Column({ name: 'scene_code', type: 'varchar', length: 64 })
  sceneCode!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @Column({ name: 'last_run_at', type: 'datetime', nullable: true })
  lastRunAt!: Date | null;

  @Column({ name: 'last_run_status', type: 'varchar', length: 32, nullable: true })
  lastRunStatus!: string | null;

  @Column({ name: 'last_run_message', type: 'text', nullable: true })
  lastRunMessage!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
