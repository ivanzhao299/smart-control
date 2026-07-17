import { Column, CreateDateColumn, Entity, Index, PrimaryGeneratedColumn, Unique, UpdateDateColumn } from 'typeorm';

/**
 * 播放列表条目 —— "平时经常播的内容", 业主随时切换。
 *
 * 2026-07-17 业主原话:
 *   "播放过的内容应该有播放历史, 平时经常播放的内容应该在播放列表里面, 随时可以切换
 *    播放列表内的内容, 在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"
 *   "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入播放列表"
 *
 * 为什么单独建表, 而不是直接用 media 表:
 *   1) **媒体库 != 播放列表**。业主明确要求媒体文件夹的东西默认**不**进播放列表 ——
 *      以后共享用户能往媒体库传东西, 不能让它自动出现在大屏可播列表里, 必须人工确认。
 *   2) **改名不能动原文件**。业主要"在播放列表里面可以更改文件名字, 便于查找" ——
 *      那是给这条播放项起个好记的别名 (如"开馆宣传片-3分钟版"), 而不是把媒体库里
 *      原始文件重命名 (原名可能是 runway-agent-xxx-20260608.mp4, 别人还在用)。
 *      所以 title 存在这里, 空则回退 media.originalName。
 *   3) 顺序是业主排的, 跟媒体库的上传时间无关。
 *
 * 注意: playback_channel 上早就有 currentPlaylistId / playlistIndex 两个字段, 但
 * **从来没有对应的表** —— 半拉子设计, 指向一个不存在的东西。这张表把它补实。
 */
@Entity({ name: 'playlist_item' })
@Unique('uq_playlist_slot_media', ['slot', 'mediaId'])
export class PlaylistItem {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 属于哪个播放通道 (1=LED 大屏, 2=投影仪, 3=背景音乐) — 各屏各自一份列表 */
  @Index()
  @Column({ type: 'int' })
  slot!: number;

  /** 指向 media 表 */
  @Column({ type: 'int', name: 'media_id' })
  mediaId!: number;

  /**
   * 业主起的别名 —— 空则用 media.originalName。
   * 改这里**不动媒体库原文件名**, 别人引用的还是原名。
   */
  @Column({ type: 'varchar', length: 120, nullable: true })
  title!: string | null;

  /** 业主拖出来的顺序 (×10 留空隙, 方便中间插入) */
  @Column({ type: 'int', default: 0, name: 'sort_order' })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
