import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 旧后台共享口令兼容表。新登录统一使用 users 个人账户；本表仅用于验证
 * 收敛前已经签发、尚未过期的后台令牌，迁移期结束后再移除。
 *
 * 所有 nullable 字段都显式 type:'varchar' (踩过 string|null 反射成 Object 的坑).
 */
@Entity({ name: 'admin_auth_v1' })
export class AdminAuth {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 已停用的共享口令哈希；新部署写入不可登录的占位值。 */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** 哪个 session 上次改过密码, 用于密码改后让其他 session 失效 (passwordChangedAt > token.issuedAt 即失效) */
  @Column({ type: 'datetime' })
  passwordChangedAt!: Date;

  /** HMAC 令牌签名密钥 (2026-07-30 签名制, 同 client_auth 的 #22 方案) — 持久化保令牌跨重启存活 */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tokenSecret!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
