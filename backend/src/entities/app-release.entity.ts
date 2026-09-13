import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * APP 版本发布信息 — 给 Android/iOS APP 启动时检查"是否有新版本"用.
 *
 * 业主原话: "如果之前用户下载了, 是不是可以在线更新呀, 或者是推送新版本".
 * 这是方案 A: APP 启动 → 调 GET /api/app/:platform/latest → 比对 versionCode →
 * 不一致弹对话框 → 点击跳浏览器下载新 APK.
 *
 * 一个 platform 一条 (单行 upsert). onModuleInit 默认写 android 当前最新版.
 * 业主在后台 "APP 版本" 页改 versionCode / downloadUrl / notes 即可.
 */
@Entity({ name: 'app_release_v1' })
export class AppRelease {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 'android' / 'ios' / 等. 一个 platform 一条 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 16 })
  platform!: string;

  /** Android versionCode / iOS CFBundleVersion 整数, APP 比对的就是这个 */
  @Column({ type: 'integer' })
  versionCode!: number;

  /** 给用户看的版本字符串, e.g. "1.0.1" */
  @Column({ type: 'varchar', length: 32 })
  versionName!: string;

  /** APK / IPA 下载链接 (GitHub release / 自管 nginx 都行) */
  @Column({ type: 'varchar', length: 512, name: 'download_url' })
  downloadUrl!: string;

  /** 更新说明 (业主写, APP 显示在弹窗) */
  @Column({ type: 'text', nullable: true })
  notes!: string | null;

  /** 强制更新 — 业主不能"稍后", 必须升级才能继续用 APP */
  @Column({ type: 'boolean', default: false, name: 'force_update' })
  forceUpdate!: boolean;

  /**
   * 最低兼容版本 — APP 启动时本地 versionCode < 这个值 → 强制升级 (即使 forceUpdate=false).
   * 业主改了关键 API 协议时, 把这个值升上去, 老 APP 自动被踢.
   */
  @Column({ type: 'integer', default: 1, name: 'min_supported_version_code' })
  minSupportedVersionCode!: number;

  /** 启用 — 关掉就 endpoint 返回 disabled, APP 不弹更新提示 (业主想停服时用) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
