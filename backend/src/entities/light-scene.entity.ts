import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 灯光场景 (软件场景) — 2026-07-21。
 *
 * 软件场景 ≠ DALI 硬件场景。DALI 硬件场景要用厂家工具把每盏灯的场景值烧进去;
 * 我们这套是纯软件: 场景只是"一组目标状态", 调用时后端遍历 light_scene_item
 * 逐个下发(分区就展开成它下面的灯)。好处是现场在后台随便存/改, 不动灯。
 *
 * e.g. "接待模式" = { 前厅分区 → 80% 4000K, 走廊分区 → 30% }
 */
@Entity({ name: 'light_scene' })
export class LightScene {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 业务编码, 唯一; seed/改名走这字段不动 id */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  /** 显示名 e.g. '接待模式' */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 楼层 tag (前端分组用); 可空 = 全馆通用 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  floor!: string | null;

  /** 图标 key */
  @Column({ type: 'varchar', length: 32, nullable: true })
  icon!: string | null;

  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
