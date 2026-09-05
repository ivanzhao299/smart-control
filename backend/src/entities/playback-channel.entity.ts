import { Column, Entity, Index, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

export type PlaybackLoopMode = 'once' | 'loop';

/**
 * 播放列表推进模式 (背景音乐 slot3 用). 一首播完后 bgm-player 调 advance,
 * 后端按这个模式决定下一首:
 *   seq     顺序播, 到最后一首就停 (回待机)
 *   loop1   单曲循环 (一直重播当前这首)
 *   loopAll 列表循环 (到末尾绕回第一首) —— 背景音乐默认, 业主要的"一直放"
 *   shuffle 随机 (不重复当前那首)
 */
export type PlaybackPlayMode = 'seq' | 'loop1' | 'loopAll' | 'shuffle';

/** 画面铺放: fill=铺满拉伸(默认) / contain=保持比例 / cover=裁切铺满 */
export type PlaybackDisplayFit = 'fill' | 'contain' | 'cover';

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
  @Column({ name: 'playback_session', type: 'varchar', length: 64, nullable: true })
  playbackSession!: string | null;

  @Column({ name: 'initiator_user_id', type: 'integer', nullable: true })
  initiatorUserId!: number | null;

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
  outputKind!: 'led' | 'projector' | 'monitor' | 'audio';

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

  /**
   * 播放列表推进模式 (背景音乐 slot3). 一首播完 bgm-player 调 advance, 后端按
   * 这个决定下一首 (seq/loop1/loopAll/shuffle). 默认 loopAll = 列表循环, 让背景
   * 音乐不依赖任何人开着网页就能自己一直放下去. slot1/2 (LED/投影) 不用它.
   */
  @Column({ type: 'varchar', length: 16, default: 'loopAll' })
  playMode!: PlaybackPlayMode;

  /**
   * 画面铺放模式 (业主 2026-07-25): fill=铺满拉伸(默认) / contain=保持比例 /
   * cover=裁切铺满。图片和视频都吃; PlayerPage 直接绑到 object-fit。
   */
  @Column({ type: 'varchar', length: 16, default: 'fill' })
  displayFit!: PlaybackDisplayFit;

  /** 文档当前页 (kind='doc' 投屏翻页; publish 时重置 1) */
  @Column({ type: 'int', default: 1 })
  docPage!: number;

  /**
   * 文档画面缩放百分比 (2026-07-29 业主: PPT 放映要能全屏/放大缩小)。
   * 100 = 铺满目标屏; >100 放大 (边缘裁掉); <100 缩小 (四周留边)。
   * PPT 原生放映由 ppt-player.ps1 按此调放映窗口几何; Word/PDF 由 kiosk 缩放。
   * publish 新内容时重置 100。
   */
  @Column({ type: 'int', default: 100 })
  docZoom!: number;

  /** 暂停标志 — bgm-player.ps1 轮询到后调 MCI pause/resume */
  @Column({ type: 'boolean', default: false })
  paused!: boolean;

  /** PlayerPage 心跳, 知道 kiosk 还活着. 太久没心跳 = 浏览器死了, 后台报警 */
  @Column({ type: 'datetime', nullable: true })
  lastHeartbeatAt!: Date | null;

  @UpdateDateColumn()
  updatedAt!: Date;
}
