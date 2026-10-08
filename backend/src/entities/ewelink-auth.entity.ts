import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 易微联 eWeLink 授权配置 (2026-10-08) — 单行表 (id=1)。
 *
 * 走 eWeLink OAuth2.0 **授权码模式**（系统已有公网域名 erp.cnjinhu.com，
 * 可用官方授权页 + 回调，不必像百度网盘那样用设备码）：
 *   1. 业主在易微联开发者平台 dev.ewelink.cn 完成个人开发者认证、创建 OAuth 应用；
 *   2. 把 AppID / AppSecret 配置进来；
 *   3. 发起授权 → 跳转易微联授权页 → 业主登录同意 → 回调 /api/integrations/ewelink/callback
 *      用 code 换 accessToken / refreshToken 落库；
 *   4. accessToken 到期前自动用 refreshToken 续期。
 *
 * AppSecret / token 均为敏感凭证：仅存库、不回显明文（status 只报布尔）。
 * 免费 AppID 限额 5 万次/月/区域，超限返回 403/412。
 */
@Entity({ name: 'ewelink_auth' })
export class EwelinkAuth {
  /** 恒为 1 — 单行配置 */
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  /** OAuth AppID（授权页 clientId / X-CK-Appid） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  appId!: string | null;

  /** OAuth AppSecret（HMAC 签名密钥，不回显） */
  @Column({ type: 'varchar', length: 128, nullable: true })
  appSecret!: string | null;

  @Column({ type: 'text', nullable: true })
  accessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  /** accessToken 过期时间（毫秒时间戳，提前续期） */
  @Column({ type: 'bigint', nullable: true })
  atExpiresAt!: string | null;

  /** refreshToken 过期时间（毫秒时间戳） */
  @Column({ type: 'bigint', nullable: true })
  rtExpiresAt!: string | null;

  /** 回调带回的区域码（cn / as / us / eu），决定 API host */
  @Column({ type: 'varchar', length: 8, nullable: true })
  region!: string | null;

  /** 当前家庭 id（拉设备列表用） */
  @Column({ type: 'varchar', length: 64, nullable: true })
  currentFamilyId!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
