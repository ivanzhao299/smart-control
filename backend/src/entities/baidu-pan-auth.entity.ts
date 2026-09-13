import { Column, Entity, PrimaryColumn, UpdateDateColumn } from 'typeorm';

/**
 * 百度网盘授权配置 (2026-07-29 业主: "在线曲库能不能连到我的百度网盘") —
 * 单行表 (id=1)。走百度 OAuth **设备码模式**: 业主在媒体页发起授权 → 显示
 * 用户码 → 手机打开 openapi.baidu.com/device 输码确认 → 后端轮询换 token。
 * 不需要公网回调地址, 完全适配内网部署。
 *
 * AppKey/SecretKey 来自业主在百度网盘开放平台 (pan.baidu.com/union) 自建的
 * 应用, 在媒体页配置弹窗里粘贴一次即可; token 自动续期。
 */
@Entity({ name: 'baidu_pan_auth' })
export class BaiduPanAuth {
  /** 恒为 1 — 单行配置 */
  @PrimaryColumn({ type: 'integer' })
  id!: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  appKey!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  secretKey!: string | null;

  /** 设备码授权进行中的 device_code (拿到 token 后清空) */
  @Column({ type: 'varchar', length: 128, nullable: true })
  deviceCode!: string | null;

  @Column({ type: 'text', nullable: true })
  accessToken!: string | null;

  @Column({ type: 'text', nullable: true })
  refreshToken!: string | null;

  /** accessToken 过期时间 (提前 5 分钟视为过期, 自动用 refreshToken 换新) */
  @Column({ type: 'datetime', nullable: true })
  expiresAt!: Date | null;

  /**
   * 可见根目录 (2026-07-30 业主隐私收紧): 设置后浏览/下载都被钳制在该目录内,
   * 网盘其余内容对系统完全不可见。null = 未设置 (全盘可见, 不推荐)。
   */
  @Column({ type: 'varchar', length: 256, nullable: true })
  rootPath!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
