import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 系统品牌 (SystemBranding) — 控制系统自身的品牌信息.
 *
 * 区别于 brand.entity.ts (那是硬件厂商目录, NovaStar / DALI 等),
 * 这张是 *本系统* 的品牌身份: 左上角 logo + 标题 + 副标题.
 *
 * 单行表 (id=1), 服务 lazy 初始化默认值, 后台直接 PUT 更新. 前台所有 layout
 * (MainLayout 平板 / AdminLayout 后台 / BrandLogo 组件) 都从 /api/system-branding
 * 读取, 不再硬编码 "金湖展贸中心". 这样不同项目 / 不同业主只换数据库一条
 * 记录就完事, 不用动代码.
 *
 * 重要 (踩坑): 所有 nullable 字段必须显式写 type: 'varchar', 因为 ts-emit 把
 *   propertyDecorator 的 design:type 对 string|null 这种联合类型编成 Object,
 *   typeorm 拿不到具体类型就抛 DataTypeNotSupportedError: Data type "Object"
 *   is not supported by better-sqlite3. 不写 type 的非 nullable string 字段
 *   typeorm 能从单一 design:type=String 推出 varchar, 没问题.
 */
@Entity({ name: 'system_branding_v2' })
export class SystemBranding {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 系统主标题, 平板顶栏 + 后台侧栏顶部. 默认 "金湖展贸中心 · 智能控制" */
  @Column({ type: 'varchar', length: 80 })
  systemName!: string;

  /** 系统副标题 / 简称, 后台侧栏第二行. 默认 "智慧展厅中控" */
  @Column({ type: 'varchar', length: 60, nullable: true })
  systemSubtitle!: string | null;

  /**
   * Logo 文字 — 左上角圆形 logo 里的 1-2 个汉字 (因为很多业主没有正式 logo 文件).
   * 默认 "金". 显示规则: 有 logoUrl 优先用图片, 没有就用这个文字.
   */
  @Column({ type: 'varchar', length: 4, default: '金' })
  logoText!: string;

  /**
   * Logo 图片 — 可以是:
   *   - data URL: 用户后台上传的图片, 前端 canvas 压缩到 256x256 + WebP 后内嵌
   *     (e.g. data:image/webp;base64,UklGRiQAAABXRUJQVlA4...), 典型 8-30 KB
   *   - http(s) URL: 老路径兼容, 比如外部 CDN
   *   - null: 用 logoText 渲染圆形文字 logo
   *
   * SQLite 实际存储是动态类型, varchar 长度只是 hint 不强制, 30KB 也能塞.
   */
  @Column({ type: 'varchar', nullable: true })
  logoUrl!: string | null;

  /** 浏览器标签页 title 用. 默认 "金湖展贸中心 控制系统" */
  @Column({ type: 'varchar', length: 80, nullable: true })
  browserTitle!: string | null;

  /** 平板首页右下角小字版权信息. 可空. */
  @Column({ type: 'varchar', length: 120, nullable: true })
  copyright!: string | null;

  /**
   * 欢迎页绑定的媒体 ID (来自 media 表).
   *
   * 业主在 MediaPage 点"设为欢迎页"后写入这个字段. LedController.welcome()
   * 收到点击后, 不再走 V2460 内置 preset, 而是查这个 mediaId 并通过 playback
   * 服务推到 slot1 (HDMI1 → LED) loop 播.
   *
   * null = 没设置 → showWelcome 回落到 V2460 preset (兼容老安装).
   */
  @Column({ type: 'integer', name: 'welcome_media_id', nullable: true })
  welcomeMediaId!: number | null;

  /**
   * 欢迎页嘉宾称谓 (2026-07-26 业主: "某某领导这个字段可以编辑")。
   * 大屏欢迎页 (frontend/public/welcome/) 20s 轮询, 改完实时变字;
   * 空/NULL 时欢迎页显示默认 "各位领导嘉宾"。
   */
  @Column({ type: 'varchar', length: 64, nullable: true, name: 'welcomeGuest' })
  welcomeGuest!: string | null;

  /**
   * 欢迎页编辑器 (2026-07-28 业主: "编辑放到前端, 可换底图可改文字, 保存立即生效"):
   * 动态欢迎页 (frontend/public/welcome/) 轮询这些字段渲染。
   * - welcomeTitle: 主标题, 空 = 默认 "热烈欢迎"
   * - welcomeTagline: 底部标语, 空 = 默认 "智慧展厅 · 数字展贸 · 科创未来"
   * - welcomeBgMediaId: 底图 (媒体库图片 id), 空 = 内置"鎏金夜湖"程序化底图
   */
  @Column({ type: 'varchar', length: 32, nullable: true, name: 'welcomeTitle' })
  welcomeTitle!: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true, name: 'welcomeTagline' })
  welcomeTagline!: string | null;

  @Column({ type: 'integer', name: 'welcomeBgMediaId', nullable: true })
  welcomeBgMediaId!: number | null;

  /**
   * 欢迎页"来访者拍照上墙"照片 (媒体库图片 id, 2026-09-14)。
   * - null = 没上传 → 欢迎页保持默认欢迎语布局
   * - 有值 → 欢迎页在欢迎语上方按照片原始方向/比例完整展示 (不裁切、不变形),
   *   只保留最新一张, 换新时由 PWA 端可恢复删除上一张。
   * 匿名读取走专门的公开路由 GET /api/system-branding/welcome-photo/file
   * (只放行当前绑定的这一张; 普通 /api/media/:id/file 需登录, 不开放)。
   */
  @Column({ type: 'integer', name: 'welcomePhotoMediaId', nullable: true })
  welcomePhotoMediaId!: number | null;

  /** 园区运营大屏可视化校准配置。JSON 文本由服务层做严格结构和范围校验。 */
  @Column({ type: 'text', name: 'parkOpsConfigJson', nullable: true })
  parkOpsConfigJson!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
