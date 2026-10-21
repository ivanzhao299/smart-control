import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * led_program_segment —— LED 节目段表（文字段/视频段，随 bin 登记）
 * 页面端真生成时把段列表逐条落库，供回放追溯与重新编排。
 */
@Entity({ name: 'led_program_segment' })
export class LedProgramSegment {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'integer' })
  @Index('ix_led_segment_program')
  programId: number;

  @Column({ type: 'integer' })
  seq: number;

  @Column({ type: 'varchar', length: 8 })
  type: 'text' | 'video';

  /** 文字段文案 */
  @Column({ type: 'text', nullable: true })
  text: string | null;

  /** 动画模板标识（如 typewriter/bounce/wave/glitch/neon/pulse…） */
  @Column({ type: 'varchar', length: 32, nullable: true })
  template: string | null;

  /** 文字颜色（#RRGGBB） */
  @Column({ type: 'varchar', length: 16, nullable: true })
  color: string | null;

  /** 视频段文件名 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  videoName: string | null;

  /** 段预计时长（毫秒） */
  @Column({ type: 'integer', nullable: true })
  durationMs: number | null;

  @CreateDateColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
