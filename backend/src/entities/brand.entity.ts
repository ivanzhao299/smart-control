import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 设备品牌 / 厂商目录 (Brand).
 *
 * 现状: hardware_unit.vendor 和 driver_template.vendor 都是 varchar 字符串
 *       (e.g. "诺瓦 NovaStar" / "中弘 ZHONGHONG"). 没有集中目录, 没法存
 *       logo / 销售联系 / 技术支持联系等额外信息.
 *
 * 这张表把 vendor 升格成一等公民:
 *   - name 跟 hardware_unit.vendor 同字符串匹配 (软关联, 不上 FK 约束)
 *   - 启动时 BrandsService 把现有 hardware_unit / driver_template 里
 *     已用到的 vendor 自动 upsert 进来, 后台再补 logo / 联系方式
 *   - 后续 hardware_unit 表单可以下拉选 brand, 一致性更强
 *
 * 不强制 FK 是为了:
 *   1) seed 数据先有 vendor 字符串, 后有 brand 表, 避免循环
 *   2) 删一个 brand 时不至于级联破坏 hardware_unit
 */
@Entity({ name: 'brands' })
export class Brand {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 品牌中文/英文标识, 跟 hardware_unit.vendor 字符串完全一致, 全局唯一 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 用户看到的显示名 (可以更长更友好), 不传默认用 name */
  @Column({ type: 'varchar', length: 128, nullable: true })
  displayName!: string | null;

  /** Logo 图片 URL (优先 media 库, 也接受外链) */
  @Column({ type: 'varchar', length: 512, nullable: true })
  logoUrl!: string | null;

  /** 国家 / 地区 (e.g. "中国 · 西安", "美国") */
  @Column({ type: 'varchar', length: 64, nullable: true })
  country!: string | null;

  /** 官网 */
  @Column({ type: 'varchar', length: 256, nullable: true })
  website!: string | null;

  /** 销售联系人 (姓名 / 电话 / 邮箱, 自由格式) */
  @Column({ type: 'varchar', length: 256, nullable: true })
  salesContact!: string | null;

  /** 技术支持联系人 (姓名 / 电话 / 邮箱 / 工单系统 URL) */
  @Column({ type: 'varchar', length: 256, nullable: true })
  techContact!: string | null;

  /** 备注 (售后政策, 报价文档链接, 历史合作情况...) */
  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  /** 启用 (禁用后实例化下拉不显示, 已有 hardware_unit 不受影响) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
