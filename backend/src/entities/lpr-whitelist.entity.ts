import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 车牌白名单 / 黑名单。
 *
 * groupName: staff 员工 / visitor 访客 / freight 货运 / black 黑名单。
 * 命中普通白名单且在有效期内 -> 相机识别时 HTTP 回复 info:ok 自动开闸;
 * isBlack=1 -> 不自动放行并在页面/大屏告警。
 * syncState 标记是否已下发相机 (comet / 识别回复 white_list_operate)。
 */
@Entity({ name: 'lpr_whitelist' })
export class LprWhitelist {
  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  plate!: string;

  /** staff / visitor / freight / black */
  @Column({ type: 'varchar', length: 16, name: 'group_name', default: 'staff' })
  groupName!: string;

  @Column({ type: 'boolean', name: 'is_black', default: false })
  isBlack!: boolean;

  @Column({ type: 'boolean', default: true })
  enable!: boolean;

  /** 生效时间, null=立即 */
  @Column({ type: 'datetime', name: 'enable_time', nullable: true })
  enableTime!: Date | null;

  /** 过期时间, null=长期有效 */
  @Column({ type: 'datetime', name: 'overdue_time', nullable: true })
  overdueTime!: Date | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  remark!: string | null;

  /** pending 待下发 / synced 已同步相机 */
  @Column({ type: 'varchar', length: 16, name: 'sync_state', default: 'pending' })
  syncState!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
