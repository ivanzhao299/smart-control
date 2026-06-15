import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type MediaKind = 'video' | 'image' | 'audio' | 'webpage';

/**
 * 媒体资源 (上传到展厅中控的视频/图片)
 *
 * 物理存储: <MEDIA_ROOT>/<id>/<safe-filename>
 *   e.g. D:\Media\42\welcome.mp4
 *
 * 用途:
 *   - 上传到 GK9000 主控
 *   - PWA 平板预览
 *   - 一键推送到 LED 大屏 (通过 HDMI1 → VX1000 全屏播放)
 */
@Entity({ name: 'media_assets' })
export class MediaAsset {
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
  @Column({ name: 'last_played_at', type: 'datetime', nullable: true })
  lastPlayedAt!: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
