import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PlaybackLoopMode = 'once' | 'loop';

/**
 * 播控通道 (PlaybackChannel) — GK9000 的 一个物理 HDMI 输出 + 它当前在播什么.
 *
 * 现场硬件接线 (2026-05-31 确认):
 *   slot=1: GK9000 HDMI1 → 诺瓦 V2460 → LED 大屏
 *   slot=2: GK9000 HDMI2 → 高清投影仪 (直连)
 *
 * 每个 slot 跑一个 Chromium kiosk 窗口 (PlayerPage.vue?slot=N), 通过 WebSocket
 * 订阅 channel.changed 事件, 收到就切 <video> / <img>. 两路完全独立, 可以同时
 * 播不同内容.
 *
 * 当前 playlist / 播到第几项 等扩展字段留位, Sprint-B 才用. 现在 Sprint A 只用
 * currentMediaId.
 *
 * 所有 nullable 字段都显式 type:'varchar' / type:'datetime' / type:'int', 避开
 * TypeScript string|null 反射成 Object 的 typeorm 大坑.
 */
@Entity({ name: 'playback_channels' })
export class PlaybackChannel {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 物理槽位: 1 = HDMI1 (→ V2460/LED), 2 = HDMI2 (→ 投影仪) */
  @Index({ unique: true })
  @Column({ type: 'int' })
  slot!: number;

  /** 人读名字, e.g. "LED 大屏 (HDMI1)" / "投影仪 (HDMI2)" */
  @Column({ type: 'varchar', length: 80 })
  name!: string;

  /** 物理输出去到哪种设备 — 给 UI / 场景动作判断用 */
  @Column({ type: 'varchar', length: 32 })
  outputKind!: 'led' | 'projector' | 'monitor';

  /** 当前正在播的媒体 ID, null = 待机 (PlayerPage 显示 logo 兜底) */
  @Column({ type: 'int', nullable: true })
  currentMediaId!: number | null;

  /** 当前在播 playlist (Sprint-B 才用), null = 不在 playlist 模式 */
  @Column({ type: 'int', nullable: true })
  currentPlaylistId!: number | null;

  /** playlist 播到第几项, 0-based */
  @Column({ type: 'int', default: 0 })
  playlistIndex!: number;

  /** 单文件 / playlist 当前项 开始播放的时间, 算播放进度用 */
  @Column({ type: 'datetime', nullable: true })
  startedAt!: Date | null;

  /** 单文件 once 模式 = 播完待机; loop = 循环单文件. playlist 模式由 playlist 自身定 */
  @Column({ type: 'varchar', length: 16, default: 'once' })
  loopMode!: PlaybackLoopMode;

  /** PlayerPage 心跳, 知道 kiosk 还活着. 太久没心跳 = 浏览器死了, 后台报警 */
  @Column({ type: 'datetime', nullable: true })
  lastHeartbeatAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
