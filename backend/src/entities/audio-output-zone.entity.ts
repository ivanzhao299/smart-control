import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 音响输出通道 (AudioOutputZone) — 2026-06-13.
 *
 * 把 EKX-808 的 8 路输出 (OUT1-OUT8) 升格成 DB 一等公民, 让业主在后台自定义
 * 每路的名字 (e.g. "一层大厅" / "二层" / "会议室") + 楼层 + 颜色, 不用改代码.
 *
 * channel 是 EKX 协议的 0-based 输出索引 (0=OUT1 ... 7=OUT8), 唯一.
 * 前端 AudioPage 拉这张表渲染 8 个通道卡, 调音量/静音时把 channel 传给 backend.
 */
@Entity({ name: 'audio_output_zone' })
export class AudioOutputZone {
  @PrimaryGeneratedColumn()
  id!: number;

  /** EKX 输出通道索引 0-7 (0=OUT1 ... 7=OUT8). 唯一. seed/升级走这字段不动 id. */
  @Index({ unique: true })
  @Column({ type: 'int' })
  channel!: number;

  /** 显示名, e.g. "OUT 1" / "一层大厅". 业主在后台改 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 楼层 tag (可空), 前端可按这个分组. 常用 '1F' / '2F' / '室外' */
  @Column({ type: 'varchar', length: 16, nullable: true })
  floor!: string | null;

  /** UI 颜色 hex (可空), 给通道卡上色. e.g. '#00E5FF' */
  @Column({ type: 'varchar', length: 16, nullable: true })
  color!: string | null;

  /** 排序 */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder!: number;

  /** 启用 — 关掉后前端不显示这路 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
