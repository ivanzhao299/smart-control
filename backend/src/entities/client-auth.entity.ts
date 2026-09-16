import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 用户令牌签名配置。身份凭据统一存放在 users；本表只保存签名密钥以及
 * 兼容期所需的旧共享会话失效时间，不再提供共享密码登录。
 */
@Entity({ name: 'client_auth_v1' })
export class ClientAuth {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 已停用的共享口令哈希；新部署写入不可登录的占位值。 */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** 改密时间, 用于让早签发的 token 失效 */
  @Column({ type: 'datetime' })
  passwordChangedAt!: Date;

  /**
   * 令牌签名密钥 (2026-07-27 加固)。老方案会话存内存 Map, 后端每次重启/部署
   * 全体 token 失效 → 业主 PWA "经常退出"。改 HMAC 签名令牌后, 密钥持久化
   * 在这里, 重启不再失效; 改密码时轮换密钥 = 全体令牌立即作废。
   */
  @Column({ type: 'varchar', length: 64, nullable: true })
  tokenSecret!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
