import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 音响输入源 (AudioInputSource) — 2026-06-14.
 *
 * EKX-808 是 8×8 矩阵, 8 路输入 (IN1-IN8) 接不同音源: 背景音乐播放器 / 话筒 /
 * GK9000 播放主机线路输出 / 无线导览 等. 把输入也升成 DB 一等公民, 让业主在后台
 * 给每路输入起名, 这样"场景路由矩阵"里看到的是【二层大厅 ← 背景音乐】而不是
 * 【OUT3 ← IN1】, 业主才看得懂、配得了.
 *
 * channel 是 EKX 协议的 0-based 输入索引 (0=IN1 ... 7=IN8), 唯一.
 */
@Entity({ name: 'audio_input_source' })
export class AudioInputSource {
  @PrimaryGeneratedColumn()
  id!: number;

  /** EKX 输入通道索引 0-7 (0=IN1 ... 7=IN8). 唯一. seed/升级走这字段不动 id. */
  @Index({ unique: true })
  @Column({ type: 'int' })
  channel!: number;

  /** 显示名, e.g. "IN 1" / "背景音乐" / "主话筒". 业主在后台改 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** UI 颜色 hex (可空), 给矩阵格子上色. e.g. '#00E5FF' */
  @Column({ type: 'varchar', length: 16, nullable: true })
  color!: string | null;

  /** 排序 */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder!: number;

  /** 启用 — 关掉后矩阵编辑器不显示这路输入 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
