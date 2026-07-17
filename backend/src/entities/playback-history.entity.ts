import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

/**
 * 播放历史 —— "播放过的内容应该有播放历史" (业主 2026-07-17)。
 *
 * 用途是**找回刚播过的东西**: 现场经常是"刚才那个片子叫什么来着, 再放一遍" ——
 * 有历史就一点即回, 不用去媒体库里翻 27 个文件。
 *
 * 为什么不复用 operation_log:
 *   那张表是运维审计流水 (谁在什么时候发了什么命令), 混着灯光/空调/矩阵所有子系统,
 *   而且会被裁剪。这里要的是"这块屏放过哪些片子"的业务视图, 要能按 slot 查、要能
 *   直接一键重播, 语义完全不同。
 *
 * 一条媒体在同一个 slot 可以有多条历史 (放过很多次), 不做唯一约束 —— 但查询时按
 * mediaId 去重取最近一次, 见 service。
 */
@Entity({ name: 'playback_history' })
export class PlaybackHistory {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 哪块屏 (1=LED, 2=投影, 3=BGM) */
  @Index()
  @Column({ type: 'int' })
  slot!: number;

  @Column({ type: 'int', name: 'media_id' })
  mediaId!: number;

  /**
   * 播的时候那个媒体叫什么 —— **快照, 不是外键**。
   * 媒体后来被删/改名了, 历史里仍然看得到当时播的是什么。
   * (2026-07-17 就踩过: slot1 指着已删除的 media 35, 界面只能显示"(媒体已删除 id=35)")
   */
  @Column({ type: 'varchar', length: 200, name: 'media_name' })
  mediaName!: string;

  @CreateDateColumn({ name: 'played_at' })
  playedAt!: Date;
}
