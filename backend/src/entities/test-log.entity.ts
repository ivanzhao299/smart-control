import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export const TEST_TYPES = [
  'device',
  'subsystem',
  'scene',
  'network_ping',
  'network_port',
] as const;
export type TestType = (typeof TEST_TYPES)[number];

@Entity({ name: 'test_logs' })
export class TestLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ name: 'test_type', type: 'varchar', length: 32 })
  testType!: TestType;

  /** 目标类别: device / subsystem(lighting/led/...) / scene / ip */
  @Index()
  @Column({ name: 'target_type', type: 'varchar', length: 32 })
  targetType!: string;

  @Index()
  @Column({ name: 'target_id', type: 'varchar', length: 128 })
  targetId!: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  command!: string | null;

  /** JSON 字符串: 请求参数 */
  @Column({ type: 'text', nullable: true })
  params!: string | null;

  /** JSON 字符串: 完整结果 (含 adapter 返回 / 失败明细) */
  @Column({ type: 'text', nullable: true })
  result!: string | null;

  @Index()
  @Column({ type: 'boolean', default: false })
  success!: boolean;

  @Column({ name: 'duration_ms', type: 'int', default: 0 })
  durationMs!: number;

  @Column({ type: 'varchar', length: 64, default: 'tester' })
  operator!: string;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
