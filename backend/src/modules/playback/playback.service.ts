import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository, In } from 'typeorm';
import { Logger } from 'winston';
import { PlaybackChannel, type PlaybackPlayMode } from '../../entities/playback-channel.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { MediaService } from '../media/media.service';
import { ControlBus } from '../../services/control-bus';

export interface PlaybackChannelView {
  id: number;
  slot: number;
  name: string;
  outputKind: 'led' | 'projector' | 'monitor' | 'audio';
  currentMediaId: number | null;
  currentMediaName: string | null;
  currentMediaKind: 'video' | 'image' | 'audio' | 'webpage' | null;
  currentMediaUrl: string | null;     // 前端 PlayerPage 直接 <video src=> / <img src=> 用
  currentMediaDurationSec: number | null;
  currentPlaylistId: number | null;
  playlistIndex: number;
  startedAt: string | null;
  loopMode: 'once' | 'loop';
  playMode: PlaybackPlayMode;
  paused: boolean;
  lastHeartbeatAt: string | null;
  /** PlayerPage 还活着吗 — 超过 90s 没心跳就 stale */
  alive: boolean;
  updatedAt: string;
}

const HEARTBEAT_STALE_MS = 90 * 1000;

@Injectable()
export class PlaybackService implements OnModuleInit {
  constructor(
    @InjectRepository(PlaybackChannel) private readonly repo: Repository<PlaybackChannel>,
    @InjectRepository(PlaylistItem) private readonly plRepo: Repository<PlaylistItem>,
    @InjectRepository(PlaybackHistory) private readonly hisRepo: Repository<PlaybackHistory>,
    private readonly mediaService: MediaService,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动时确保 slot=1 + slot=2 两条记录存在 (现场硬件就两路). 没有就插默认 */
  async onModuleInit(): Promise<void> {
    const seeds: Array<Pick<PlaybackChannel, 'slot' | 'name' | 'outputKind'>> = [
      { slot: 1, name: 'LED 大屏 (HDMI1)', outputKind: 'led' },
      { slot: 2, name: '投影仪 (HDMI2)', outputKind: 'projector' },
      // slot 3: GK9000 声卡输出 → EKX 音响输入. PlayerPage?slot=3 用 HTML5 audio
      // 播音频, Chromium 声卡输出走 GK9000 3.5mm → EKX IN.
      { slot: 3, name: '背景音乐 (声卡→音响)', outputKind: 'audio' },
    ];
    for (const s of seeds) {
      const exists = await this.repo.findOne({ where: { slot: s.slot } });
      if (!exists) {
        await this.repo.save(
          this.repo.create({
            slot: s.slot,
            name: s.name,
            outputKind: s.outputKind,
            currentMediaId: null,
            currentPlaylistId: null,
            playlistIndex: 0,
            startedAt: null,
            loopMode: 'once',
            lastHeartbeatAt: null,
          }),
        );
        this.logger.info(`[PlaybackChannel] seeded slot=${s.slot} (${s.outputKind})`);
      }
    }
  }

  async list(): Promise<PlaybackChannelView[]> {
    const rows = await this.repo.find({ order: { slot: 'ASC' } });
    return Promise.all(rows.map((r) => this.toView(r)));
  }

  async getBySlot(slot: number): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    return this.toView(row);
  }

  /**
   * 把媒体推到指定 slot.
   * - 更新 channel state (currentMediaId / startedAt / loopMode)
   * - WS 广播 playback_channel_changed
   * - PlayerPage 收到 WS 事件就切 <video> / <img>
   */
  async publishMedia(slot: number, mediaId: number, opts: { loopMode?: 'once' | 'loop' } = {}): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    // 校验媒体存在
    const m = await this.mediaService.get(mediaId).catch(() => null);
    if (!m) throw new BadRequestException(`媒体 ${mediaId} 不存在`);

    // 展厅大屏默认循环: 播一遍就回待机等于要人守着重推, 现场没人干这事
    // (2026-07-16 业主: "没有人工干预就让它循环播放")
    const loopMode = opts.loopMode ?? 'loop';
    // 只写"推送新媒体"该动的这几个字段, 不整行 save —— 否则会把 playMode /
    // lastHeartbeatAt 这些不相干的字段一起写回旧值 (见 pause 上方注释)
    await this.repo.update({ slot }, {
      currentMediaId: mediaId,
      currentPlaylistId: null,
      playlistIndex: 0,
      startedAt: new Date(),
      loopMode,
      paused: false,
    });

    // 记历史: 现场常有"刚才那片子叫啥来着, 再放一遍" —— 有历史就一点即回,
    // 不用去媒体库翻。名字存快照, 媒体以后被删/改名, 历史仍看得到当时播的是什么。
    await this.hisRepo.save(this.hisRepo.create({
      slot, mediaId, mediaName: m.originalName ?? `media ${mediaId}`,
    }));

    const view = await this.getBySlot(slot);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → media id=${mediaId} (${m.originalName}, loop=${loopMode})`);
    return view;
  }


  // ============ 播放列表 (业主: "平时经常播放的内容应该在播放列表里面") ============

  /**
   * 某块屏的播放列表。title 为空则回退媒体原名。
   * 媒体被删了仍返回该条 (标 missing), 让业主看得到并能删掉它 —— 不能默默藏起来,
   * 否则就是 2026-07-17 那个"slot 指着已删除 media 35, 界面只显示(媒体已删除)"的翻版。
   */
  async listPlaylist(slot: number): Promise<Array<{
    id: number; mediaId: number; title: string; sortOrder: number;
    kind: string | null; durationSec: number | null; missing: boolean;
  }>> {
    const rows = await this.plRepo.find({ where: { slot }, order: { sortOrder: 'ASC', id: 'ASC' } });
    const out = [];
    for (const r of rows) {
      const m = await this.mediaService.get(r.mediaId).catch(() => null);
      out.push({
        id: r.id,
        mediaId: r.mediaId,
        title: r.title ?? m?.originalName ?? `media ${r.mediaId}`,
        sortOrder: r.sortOrder,
        kind: m?.kind ?? null,
        durationSec: m?.durationSec ?? null,
        missing: !m,
      });
    }
    return out;
  }

  /**
   * 把媒体加进播放列表 —— **必须人工调用**。
   * 业主: "媒体文件夹内容默认不加入播放列表, 需经管理员确认后再手工加入播放列表"。
   * 所以上传/扫描等任何自动流程都不许调这个。
   */
  async addToPlaylist(slot: number, mediaId: number, title?: string): Promise<{ id: number }> {
    const m = await this.mediaService.get(mediaId).catch(() => null);
    if (!m) throw new BadRequestException(`媒体 ${mediaId} 不存在`);
    const exists = await this.plRepo.findOne({ where: { slot, mediaId } });
    if (exists) return { id: exists.id };
    const max = await this.plRepo.find({ where: { slot }, order: { sortOrder: 'DESC' }, take: 1 });
    const row = await this.plRepo.save(this.plRepo.create({
      slot, mediaId,
      title: title?.trim() || null,
      sortOrder: (max[0]?.sortOrder ?? 0) + 10,
    }));
    return { id: row.id };
  }

  /**
   * 改播放列表里的显示名 —— **只改别名, 不动媒体库原文件名**。
   * 业主: "在播放列表里面可以更改文件名字, 便于随时查找需要播放的素材"。
   * 原名可能是 runway-agent-xxx-20260608.mp4, 别处还在引用, 不能动。
   */
  async renamePlaylistItem(id: number, title: string): Promise<{ id: number; title: string }> {
    const row = await this.plRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`播放列表项 #${id} 不存在`);
    row.title = title.trim() || null;
    await this.plRepo.save(row);
    return { id: row.id, title: row.title ?? '' };
  }

  async removeFromPlaylist(id: number): Promise<{ id: number }> {
    const row = await this.plRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`播放列表项 #${id} 不存在`);
    await this.plRepo.remove(row);
    return { id };
  }

  /** 拖拽排序 (同灯光分区: 顺序存后端, 现场多终端要一致) */
  async reorderPlaylist(ids: number[]): Promise<{ count: number }> {
    const rows = await this.plRepo.find({ where: { id: In(ids) } });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const touched: PlaylistItem[] = [];
    ids.forEach((id, i) => {
      const r = byId.get(id);
      if (r) { r.sortOrder = (i + 1) * 10; touched.push(r); }
    });
    if (touched.length) await this.plRepo.save(touched);
    return { count: touched.length };
  }

  // ============ 上一个 / 下一个 (业主: "不能一直无脑播放, 保持用户控制状态") ============

  /**
   * 在播放列表里前后切换。
   *
   * 以**当前正在播的 mediaId** 在列表中的位置为准, 而不是信 playlistIndex ——
   * 业主可能中途从媒体库直接推了别的片子, 或者列表被增删过, index 早就对不上了。
   * 当前片子不在列表里 (比如从媒体库临时推的): 下一个 = 列表第一个, 上一个 = 最后一个,
   * 这样从任何状态都能一键回到列表, 不会卡死。
   * 列表空 = 不动, 照实说, 别静默失败。
   */
  async step(slot: number, dir: 1 | -1): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    const list = await this.plRepo.find({ where: { slot }, order: { sortOrder: 'ASC', id: 'ASC' } });
    if (list.length === 0) throw new BadRequestException('播放列表是空的, 先把常播内容加进列表');

    const cur = list.findIndex((x) => x.mediaId === row.currentMediaId);
    let next: number;
    if (cur < 0) next = dir === 1 ? 0 : list.length - 1;
    else next = (cur + dir + list.length) % list.length;   // 环形, 到头绕回去

    return this.publishMedia(slot, list[next].mediaId, { loopMode: row.loopMode as 'once' | 'loop' });
  }

  // ============ 自动推进 (背景音乐一首播完后, bgm-player 触发) ============

  /**
   * 一首播完后自动推进 —— bgm-player.ps1 播完当前曲就 POST /channels/:slot/advance.
   *
   * 这是"背景音乐不依赖任何人开着网页也能一直放"的核心: 推进逻辑放后端, 由真正
   * 出声的 bgm-player 守护触发, 而不是靠某个浏览器 tab 的 JS 定时器 (那正是搞了一天
   * 反复没声的病根 —— tab 一关就没有下一首了)。按 playMode 决定下一步:
   *   loop1   重播当前这首
   *   seq     下一首; 已是最后一首 → 停 (回待机)
   *   shuffle 随机一首 (多首时不重复当前)
   *   loopAll 环形下一首 (到末尾绕回第一首) —— 默认
   * 当前曲不在列表 (从媒体库临时推的) / 列表空: 有当前曲就重播它, 否则不动, 从任何
   * 状态都不会卡死。
   */
  async advance(slot: number): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    const mode: PlaybackPlayMode = row.playMode ?? 'loopAll';

    // 单曲循环: 直接重播当前 (不看列表)
    if (mode === 'loop1' && row.currentMediaId !== null) {
      return this.publishMedia(slot, row.currentMediaId, { loopMode: row.loopMode });
    }

    const list = await this.plRepo.find({ where: { slot }, order: { sortOrder: 'ASC', id: 'ASC' } });

    // 列表空: 无从推进. 有当前曲就重播 (别让背景音乐彻底停), 否则不动.
    if (list.length === 0) {
      if (row.currentMediaId !== null) return this.publishMedia(slot, row.currentMediaId, { loopMode: row.loopMode });
      return this.toView(row);
    }

    const cur = list.findIndex((x) => x.mediaId === row.currentMediaId);

    if (mode === 'shuffle') {
      let pick = cur;
      if (list.length > 1) { while (pick === cur) pick = Math.floor(Math.random() * list.length); }
      else pick = 0;
      return this.publishMedia(slot, list[pick].mediaId, { loopMode: row.loopMode });
    }

    if (mode === 'seq') {
      if (cur < 0) return this.publishMedia(slot, list[0].mediaId, { loopMode: row.loopMode });
      if (cur >= list.length - 1) return this.stop(slot); // 顺序播到底 → 待机
      return this.publishMedia(slot, list[cur + 1].mediaId, { loopMode: row.loopMode });
    }

    // loopAll (默认): 环形下一首
    const next = cur < 0 ? 0 : (cur + 1) % list.length;
    return this.publishMedia(slot, list[next].mediaId, { loopMode: row.loopMode });
  }

  /** 设背景音乐播放模式 (前端点 顺序/单曲/列表/随机). 存后端, bgm-player advance 时读它. */
  async setPlayMode(slot: number, mode: PlaybackPlayMode): Promise<PlaybackChannelView> {
    // 只写 playMode: 改播放模式不该把当前在播的曲子/暂停状态一起冲掉
    const res = await this.repo.update({ slot }, { playMode: mode });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → playMode=${mode}`);
    return view;
  }

  // ============ 播放历史 ============

  /**
   * 最近播过的, 按媒体去重取最近一次 —— 同一个片子放 20 遍不该刷屏 20 条。
   */
  async listHistory(slot: number, limit = 20): Promise<Array<{
    mediaId: number; mediaName: string; playedAt: Date; missing: boolean;
  }>> {
    const rows = await this.hisRepo.find({ where: { slot }, order: { playedAt: 'DESC' }, take: 200 });
    const seen = new Set<number>();
    const out = [];
    for (const r of rows) {
      if (seen.has(r.mediaId)) continue;
      seen.add(r.mediaId);
      const m = await this.mediaService.get(r.mediaId).catch(() => null);
      out.push({ mediaId: r.mediaId, mediaName: m?.originalName ?? r.mediaName, playedAt: r.playedAt, missing: !m });
      if (out.length >= limit) break;
    }
    return out;
  }

  /** 清掉当前播放, 回到待机 (PlayerPage 显示 logo + 系统名称) */
  async stop(slot: number): Promise<PlaybackChannelView> {
    // 只清播放状态相关字段, 不碰 playMode / lastHeartbeatAt (见 pause 上方注释)
    const res = await this.repo.update({ slot }, {
      currentMediaId: null,
      currentPlaylistId: null,
      playlistIndex: 0,
      startedAt: null,
      paused: false,
    });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);

    const view = await this.getBySlot(slot);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → idle`);
    return view;
  }

  /**
   * ⚠️ 播控写入一律"按字段 update", 不要 findOne → 改字段 → save(row)。
   *
   * save(row) 会把**读到那一刻的整行**写回去。播控这张表同时被三方写:
   * 用户操作(暂停/推媒体/切曲)、bgm-player 的自动 advance、PlayerPage 的 30s 心跳。
   * 整行写回就会互相冲掉对方刚改的字段, 典型症状:
   *   - 点暂停的瞬间 bgm 刚推进下一首 → 暂停把 currentMediaId 冲回上一首
   *   - 心跳把用户刚点的暂停冲回 false → "点了暂停过一会儿自己又播了"
   * 只写自己该写的字段就不会互相踩; 写完重新读一次拿到最新完整状态再广播,
   * 这样 WS 推出去的也是准的 (而不是自己内存里那份旧 row)。
   */
  async pause(slot: number): Promise<PlaybackChannelView> {
    const res = await this.repo.update({ slot }, { paused: true });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    return view;
  }

  async resume(slot: number): Promise<PlaybackChannelView> {
    const res = await this.repo.update({ slot }, { paused: false });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    return view;
  }

  /**
   * PlayerPage 心跳 — 证明 kiosk 还活着. 超过 HEARTBEAT_STALE_MS 没收到就 alive=false
   *
   * ⚠️ 只按字段 update, 不做 read-modify-write 整行 save.
   * 原来是 findOne → 改 lastHeartbeatAt → save(row): save 会把**读到那一刻的整行**写回去.
   * 而心跳是全系统最高频的写 (大屏/投影/BGM 三个 slot 各 30s 一次) —— 如果这期间用户点了
   * 暂停、推了新媒体, 或 bgm-player 调了 advance, 心跳就会拿它读到的旧快照把这些改动覆盖掉
   * (典型表现: 点了暂停过一会儿自己又播了 / 刚推的媒体被弹回上一个). 按字段 update 之后,
   * 心跳只碰 lastHeartbeatAt, 不再跟播控命令抢同一行.
   */
  async heartbeat(slot: number): Promise<void> {
    const res = await this.repo.update({ slot }, { lastHeartbeatAt: new Date() });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);
    // 心跳不广播 WS, 太频繁; 前端要看 PlayerPage 活没活直接 GET /api/playback
  }

  private async toView(row: PlaybackChannel): Promise<PlaybackChannelView> {
    let mediaName: string | null = null;
    let mediaKind: 'video' | 'image' | 'audio' | 'webpage' | null = null;
    let mediaUrl: string | null = null;
    let durationSec: number | null = null;
    if (row.currentMediaId !== null) {
      const m = await this.mediaService.get(row.currentMediaId).catch(() => null);
      if (m) {
        mediaName = m.originalName;
        mediaKind = m.kind;
        // webpage 用外部 URL (PlayerPage iframe); 其它走物理文件 (相同 host)
        mediaUrl = m.kind === 'webpage' ? m.sourceUrl : `/api/media/${m.id}/file`;
        durationSec = m.durationSec;
      } else {
        // 媒体被删了但 channel 还指着它 → 当成 stop, 但不主动改库, 留给下次 publish 覆盖
        mediaName = `(媒体已删除 id=${row.currentMediaId})`;
      }
    }
    const alive = row.lastHeartbeatAt
      ? Date.now() - row.lastHeartbeatAt.getTime() < HEARTBEAT_STALE_MS
      : false;
    return {
      id: row.id,
      slot: row.slot,
      name: row.name,
      outputKind: row.outputKind,
      currentMediaId: row.currentMediaId,
      currentMediaName: mediaName,
      currentMediaKind: mediaKind,
      currentMediaUrl: mediaUrl,
      currentMediaDurationSec: durationSec,
      currentPlaylistId: row.currentPlaylistId,
      playlistIndex: row.playlistIndex,
      startedAt: row.startedAt ? row.startedAt.toISOString() : null,
      loopMode: row.loopMode,
      playMode: row.playMode ?? 'loopAll',
      paused: row.paused ?? false,
      lastHeartbeatAt: row.lastHeartbeatAt ? row.lastHeartbeatAt.toISOString() : null,
      alive,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private broadcast(view: PlaybackChannelView): void {
    this.bus.publish({
      type: 'playback_channel_changed',
      slot: view.slot,
      view,
      at: new Date().toISOString(),
    });
  }
}
