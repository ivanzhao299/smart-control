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

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
