import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 音响一键场景 (AudioScene) — 2026-06-13.
 *
 * EKX-808 内置 12 个用户预设 (U01-U12), 内容 (路由/音量/EQ) 由集成商在 PC Editor
 * 里预录入. 这张表只存"每个预设号给业主看的名字 + 提示", 让业主在后台自定义,
 * 不用改前端代码.
 *
 * presetNum 是 EKX 用户预设号 1-12 (对应 U01-U12), 唯一.
 * 前端 AudioPage 拉这张表渲染场景按钮, 点击时把 presetNum 传给 backend recall.
 */
@Entity({ name: 'audio_scene' })
export class AudioScene {
  @PrimaryGeneratedColumn()
  id!: number;

  /** EKX 用户预设号 1-12 (U01-U12). 唯一. */
  @Index({ unique: true })
  @Column({ type: 'int', name: 'preset_num' })
  presetNum!: number;

  /** 场景显示名, e.g. "早班接待" / "路演演讲". 业主在后台改 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 提示说明 (可空), e.g. "8-10点全场低音量 BGM" */
  @Column({ type: 'varchar', length: 128, nullable: true })
  hint!: string | null;

  /**
   * 场景实际内容 — 后台可编辑的"矩阵路由 + 各路音量 + 静音" (2026-06-14).
   * JSON 字符串, 结构: { outputs: [{ ch, inputs:[...], volume?, muted? }] }
   *   - ch: 输出通道 0-7
   *   - inputs: 喂给这路输出的输入通道号数组 (8×8 矩阵, 可多源混音)
   *   - volume: 输出音量 0-100 (可空=不改)
   *   - muted: 是否静音 (可空=不改)
   * 切场景时后端按这个逐条发 setMatrix + setOutputVolume + mute 把矩阵摆成这样.
   * 为空 (null) → 回退到调设备内置预设 U0N (老行为, 兼容没配过内容的场景).
   */
  @Column({ type: 'text', nullable: true })
  content!: string | null;

  /** 排序 */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder!: number;

  /** 启用 — 关掉后前端不显示这个场景按钮 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn()
  createdAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
