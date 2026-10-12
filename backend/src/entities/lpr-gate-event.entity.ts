import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 道闸状态事件 (barr_gate_status_notify)。
 * gateStatus: 0 关到位 / 1 开到位 / 2 中间(运行中)。
 * connectStatus: 道闸控制器与相机的连接状态 (0 断开 / 1 连接, 以现场码表为准)。
 */
@Entity({ name: 'lpr_gate_event' })
export class LprGateEvent {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index()
  @Column({ type: 'varchar', length: 64 })
  serialno!: string;

  /** 0 关到位 / 1 开到位 / 2 中间 */
  @Column({ type: 'integer', name: 'gate_status' })
  gateStatus!: number;

  /** 道闸控制器连接状态, 可空 */
  @Column({ type: 'integer', name: 'connect_status', nullable: true })
  connectStatus!: number | null;

  /** 道闸功能使能, 可空 */
  @Column({ type: 'integer', nullable: true })
  enabled!: number | null;

  @Column({ type: 'datetime', name: 'event_time', nullable: true })
  eventTime!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
