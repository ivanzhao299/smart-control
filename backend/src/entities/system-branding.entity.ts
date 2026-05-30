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
 */
@Entity({ name: 'system_branding' })
export class SystemBranding {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 系统主标题, 平板顶栏 + 后台侧栏顶部. 默认 "金湖展贸中心 · 智能控制" */
  @Column({ length: 80 })
  systemName!: string;

  /** 系统副标题 / 简称, 后台侧栏第二行. 默认 "智慧展厅中控" */
  @Column({ length: 60, nullable: true })
  systemSubtitle!: string | null;

  /**
   * Logo 文字 — 左上角圆形 logo 里的 1-2 个汉字 (因为很多业主没有正式 logo 文件).
   * 默认 "金". 显示规则: 有 logoUrl 优先用图片, 没有就用这个文字.
   */
  @Column({ length: 4, default: '金' })
  logoText!: string;

  /**
   * Logo 图片 URL — 可选, 业主上传后填这里 (e.g. /api/media/<id>/file).
   * null 表示不用图片, 用 logoText.
   */
  @Column({ nullable: true })
  logoUrl!: string | null;

  /** 浏览器标签页 title 用. 默认 "金湖展贸中心 控制系统" */
  @Column({ length: 80, nullable: true })
  browserTitle!: string | null;

  /** 平板首页右下角小字版权信息. 可空. */
  @Column({ length: 120, nullable: true })
  copyright!: string | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
