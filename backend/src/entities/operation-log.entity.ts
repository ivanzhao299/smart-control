import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

export type LogResult = 'success' | 'failure';

@Entity({ name: 'operation_logs' })
export class OperationLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 64, default: 'system' })
  operator!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  terminal!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  action!: string;

  @Index()
  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType!: string;

  @Column({ name: 'target_id', type: 'varchar', length: 64, nullable: true })
  targetId!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'success' })
  result!: LogResult;

  @Column({ type: 'text', nullable: true })
  message!: string | null;

  /** Sprint-04 spec Task-016: 设备调用耗时 (ms) */
  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs!: number;

  /** Sprint-04 spec Task-016: 实际重试次数 (含首次) */
  @Column({ name: 'retry_count', type: 'int', default: 1 })
  retryCount!: number;

  /** Sprint-04 spec Task-016: 超时阈值 (ms), 适配器调用时填 */
  @Column({ name: 'timeout_ms', type: 'int', nullable: true })
  timeoutMs!: number | null;

  /** Sprint-04 spec Task-016: 设备 raw 响应 (JSON 字符串), 用于排查 */
  @Column({ name: 'raw_response', type: 'text', nullable: true })
  rawResponse!: string | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
