import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * led_program —— LED 节目 bin 主表（页面端真生成 bin 后的登记/追溯）
 * bin 文件本体落在非系统盘数据目录（LED_STORAGE_DIR），此表只存登记信息。
 * 2026-10-21 生产化：效果图"生成节目 bin"由预览模拟升级为页面端真生成。
 */
@Entity({ name: 'led_program' })
export class LedProgram {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 节目编排快照（段列表 JSON，含类型/文案/动画/颜色/视频名/时长） */
  @Column({ type: 'text', nullable: true })
  contentJson!: string | null;

  /** bin 绝对路径（非系统盘数据目录） */
  @Column({ type: 'varchar', length: 512 })
  binPath!: string;

  @Column({ type: 'integer' })
  fileSize!: number;

  @Column({ type: 'varchar', length: 32 })
  @Index('ix_led_program_md5')
  md5!: string;

  @Column({ type: 'integer', default: 1 })
  cycles!: number;

  @Column({ type: 'integer', default: 25 })
  fps!: number;

  @Column({ name: 'template_type', type: 'varchar', length: 32, default: 'custom' })
  templateType!: string;

  /** 组合节目成员ID列表（JSON数组），templateType='combo'时生效 */
  @Column({ name: 'combo_members', type: 'text', nullable: true })
  comboMembers!: string | null;

  @Column({ type: 'integer', default: 0 })
  durationS!: number;

  @Column({ type: 'varchar', length: 32, default: 'admin' })
  createdBy!: string;

  @CreateDateColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  createdAt!: Date;

  @UpdateDateColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  updatedAt!: Date;
}
