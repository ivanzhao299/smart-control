import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn, ManyToOne, JoinColumn } from 'typeorm';
import { User } from './user.entity';

export type MediaKind = 'video' | 'image' | 'audio' | 'webpage' | 'doc';
export type MediaProcessingStatus = 'ready' | 'pending' | 'processing' | 'failed';

/**
 * 媒体资源 (上传到展厅中控的视频/图片)
 *
 * 物理存储: <MEDIA_ROOT>/<id>/<safe-filename>
 * 拍照上屏: <MEDIA_ROOT>/welcome-photos/<id>/<safe-filename>
 *   e.g. D:\Media\welcome-photos\42\welcome-led.jpg
 *
 * 用途:
 *   - 上传到 GK9000 主控
 *   - PWA 平板预览
 *   - 一键推送到 LED 大屏 (通过 HDMI1 → VX1000 全屏播放)
 */
@Entity({ name: 'media_assets' })
export class MediaAsset {
  @Index('ix_media_assets_owner')
  @Column({ name: 'owner_user_id', type: 'integer', nullable: true })
  ownerUserId!: number | null;

  @ManyToOne(() => User, { nullable: true, onDelete: 'RESTRICT' })
  @JoinColumn({ name: 'owner_user_id', foreignKeyConstraintName: 'fk_media_assets_owner' })
  owner!: User | null;

  @Column({ type: 'varchar', default: 'private' })
  visibility!: 'private' | 'shared';

  @Column({ type: 'varchar', default: 'upload' })
  source!: 'upload' | 'legacy' | 'system' | 'webpage' | 'import';

  /** Stable deployment-owned identity for immutable bundled assets. */
  @Index('ux_media_assets_system_key', { unique: true, where: 'system_key IS NOT NULL' })
  @Column({ name: 'system_key', type: 'varchar', length: 100, nullable: true })
  systemKey!: string | null;

  /** Expected repository artifact digest for a bundled file; null for webpages. */
  @Column({ name: 'artifact_sha256', type: 'varchar', length: 64, nullable: true })
  artifactSha256!: string | null;

  @PrimaryGeneratedColumn()
  id!: number;

  /** 原始文件名 (用户上传时的名字, 含扩展名) */
  @Column({ type: 'varchar', length: 255 })
  originalName!: string;

  /** 安全文件名 (磁盘上实际存的名字, 去除特殊字符) */
  @Column({ type: 'varchar', length: 255 })
  safeName!: string;

  /** 绝对路径 (e.g. D:\Media\42\welcome.mp4) */
  @Column({ type: 'varchar', length: 500 })
  path!: string;

  /** 转码后 path 指向播放副本；原文件始终保留在 sourcePath。 */
  @Column({ type: 'varchar', length: 500, nullable: true })
  sourcePath!: string | null;

  @Column({ type: 'varchar', length: 16, default: 'ready' })
  processingStatus!: MediaProcessingStatus;

  @Column({ type: 'varchar', length: 1000, nullable: true })
  processingError!: string | null;

  /** 缩略图路径 (图片自身缩放; 视频用 ffmpeg 提取第 1 秒帧; 可空表示未生成) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  thumbPath!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 16 })
  kind!: MediaKind;

  /** 网页类型 (kind='webpage') 的外部 URL; 其它类型为 null (走物理文件) */
  @Column({ type: 'varchar', length: 1000, nullable: true })
  sourceUrl!: string | null;

  @Column({ type: 'varchar', length: 128 })
  mimeType!: string;

  /** 文件大小, 字节 */
  @Column({ type: 'bigint' })
  sizeBytes!: number;

  /** 视频时长秒, 图片为 null */
  @Column({ type: 'int', nullable: true })
  durationSec!: number | null;

  /** 分辨率 (e.g. "1920x1080"), 图片 + 视频都有, 解析失败则 null */
  @Column({ type: 'varchar', length: 32, nullable: true })
  resolution!: string | null;

  /** 用户备注 (可选, 上传时可填) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  remark!: string | null;

  /** 上传操作员 (取自请求 header / token, MVP 默认 "system") */
  @Column({ type: 'varchar', length: 64, default: 'system' })
  uploader!: string;

  /** 最近一次推送到大屏时间 */
  /** 文档总页数 (kind='doc'; 放映守护用 PowerPoint/Word COM 回写) */
  @Column({ type: 'int', nullable: true })
  pageCount!: number | null;

  /** Word 转出的 PDF 相对路径 (kind='doc' 且为 word 时; PPT 原生放映不需要) */
  @Column({ type: 'varchar', length: 500, nullable: true })
  docPdfPath!: string | null;

  @Column({ name: 'last_played_at', type: 'datetime', nullable: true })
  lastPlayedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
