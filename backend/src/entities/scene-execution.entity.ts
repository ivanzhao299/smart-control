import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const EXECUTION_STATUSES = [
  'pending',
  'running',
  'success',
  'partial_failed',
  'failed',
  'cancelled',
] as const;
export type ExecutionStatusValue = (typeof EXECUTION_STATUSES)[number];

export const TRIGGER_TYPES = ['manual', 'schedule', 'system'] as const;
export type TriggerType = (typeof TRIGGER_TYPES)[number];

@Entity({ name: 'scene_executions' })
export class SceneExecution {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ name: 'execution_id', type: 'varchar', length: 64 })
  executionId!: string;

  @Index()
  @Column({ name: 'scene_code', type: 'varchar', length: 64 })
  sceneCode!: string;

  @Column({ name: 'scene_name', type: 'varchar', length: 128 })
  sceneName!: string;

  @Index()
  @Column({ name: 'trigger_type', type: 'varchar', length: 16 })
  triggerType!: TriggerType;

  @Column({ name: 'trigger_source', type: 'varchar', length: 128 })
  triggerSource!: string;

  @Index()
  @Column({ type: 'varchar', length: 32, default: 'pending' })
  status!: ExecutionStatusValue;

  @Column({ name: 'started_at', type: 'datetime', nullable: true })
  startedAt!: Date | null;

  @Column({ name: 'finished_at', type: 'datetime', nullable: true })
  finishedAt!: Date | null;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs!: number;

  @Column({ name: 'total_actions', type: 'int', default: 0 })
  totalActions!: number;

  @Column({ name: 'success_count', type: 'int', default: 0 })
  successCount!: number;

  @Column({ name: 'failed_count', type: 'int', default: 0 })
  failedCount!: number;

  /** JSON 字符串: { failures: [{deviceType,deviceId,command,error}], notes?: string } */
  @Column({ name: 'result_summary', type: 'text', nullable: true })
  resultSummary!: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
