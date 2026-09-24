import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * TestFlight 内部测试员邀请记录 — 由后台「iOS 测试」页驱动, 服务端持 App Store
 * Connect API 密钥直接调用 ASC API 完成邀请 (不经过 iOS App, 也不依赖 CI)。
 *
 * 内部测试员在 ASC 里本质是「团队用户」, 必须至少挂一个角色; 本系统固定授予最小
 * 权限 MARKETING, allAppsVisible=false, 仅可见金湖智控这一个 App。
 *
 * 一个邮箱在团队范围内只有一条有效邀请/成员关系, 因此 email 唯一, 同时承担幂等键:
 * 重复邀请同一邮箱直接回到已存在的 PENDING/ACCEPTED 状态, 不会在苹果侧产生垃圾数据。
 */
export type TestFlightInvitationStatus = 'PENDING' | 'ACCEPTED' | 'FAILED';

@Entity({ name: 'testflight_invitation_v1' })
export class TestFlightInvitation {
  @PrimaryGeneratedColumn()
  id!: number;

  /** ASC userInvitations 资源 id (创建成功后回填; 接受后该邀请资源会消失, 此字段保留历史值) */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'apple_invitation_id' })
  appleInvitationId!: string | null;

  /** 受邀人邮箱 (即其 Apple ID), 小写归一, 团队内唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 254 })
  email!: string;

  @Column({ type: 'varchar', length: 80, name: 'first_name' })
  firstName!: string;

  @Column({ type: 'varchar', length: 80, name: 'last_name' })
  lastName!: string;

  /** ASC 团队角色, 固定最小权限 MARKETING */
  @Column({ type: 'varchar', length: 32, default: 'MARKETING' })
  role!: string;

  /** ASC App AdamID, e.g. 6795375392 (金湖智控) */
  @Column({ type: 'varchar', length: 20, name: 'app_id' })
  appId!: string;

  /** PENDING=邀请已发待接受; ACCEPTED=已是团队用户(已能内测); FAILED=最近一次邀请失败 */
  @Column({ type: 'varchar', length: 20, default: 'PENDING' })
  status!: TestFlightInvitationStatus;

  /** 苹果侧邀请过期时间 (PENDING 时有值, 通常 72 小时) */
  @Column({ type: 'datetime', nullable: true, name: 'expiration_date' })
  expirationDate!: Date | null;

  /** 最近一次苹果接口报错原文 (成功后置空), 便于排障 */
  @Column({ type: 'text', nullable: true, name: 'last_error' })
  lastError!: string | null;

  /** 执行邀请/重发的后台管理员用户名 */
  @Column({ type: 'varchar', length: 120, nullable: true, name: 'invited_by' })
  invitedBy!: string | null;

  /** 最近一次成功发起邀请/重发的时间 */
  @Column({ type: 'datetime', nullable: true, name: 'invited_at' })
  invitedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
