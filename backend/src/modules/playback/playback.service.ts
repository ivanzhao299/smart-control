import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository, In, IsNull } from 'typeorm';
import { Actor } from '../../common/auth/actor';
import { visiblePlaylistWhere } from '../../common/auth/playlist-scope';
import { assertCanUpload, assertCanPublish, canReadResource } from '../../common/auth/resource-policy';
import { Logger } from 'winston';
import { PlaybackChannel, type PlaybackDisplayFit, type PlaybackPlayMode } from '../../entities/playback-channel.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaService } from '../media/media.service';
import { ControlBus } from '../../services/control-bus';

export interface PlaybackChannelView {
  playbackSession: string | null;
  occupied: boolean;
  restricted: boolean;
  id: number;
  slot: number;
  name: string;
  outputKind: 'led' | 'projector' | 'monitor' | 'audio';
  currentMediaId: number | null;
  currentMediaName: string | null;
  currentMediaKind: 'video' | 'image' | 'audio' | 'webpage' | 'doc' | null;
  currentMediaUrl: string | null;     // 前端 PlayerPage 直接 <video src=> / <img src=> 用
  currentMediaDurationSec: number | null;
  currentPlaylistId: number | null;
  playlistIndex: number;
  startedAt: string | null;
  loopMode: 'once' | 'loop';
  playMode: PlaybackPlayMode;
  /** 画面铺放: fill=铺满拉伸(默认)/contain=保持比例/cover=裁切铺满, 图片和视频都吃 */
  displayFit: PlaybackDisplayFit;
  /** 文档当前页 (kind='doc'; 手机翻页条驱动, 守护/kiosk 跟随) */
  docPage: number;
  /** 文档画面缩放 % (100=铺满; PPT 放映窗口/kiosk PDF 都吃) */
  docZoom: number;
  /** 文档总页数 (放映守护回写; null=还没算出来) */
  currentMediaPageCount: number | null;
  paused: boolean;
  lastHeartbeatAt: string | null;
  /** PlayerPage 还活着吗 — 超过 90s 没心跳就 stale */
  alive: boolean;
  updatedAt: string;
}

const HEARTBEAT_STALE_MS = 90 * 1000;

@Injectable()
export class PlaybackService implements OnModuleInit {
  // better-sqlite3 shares one connection. Concurrent async transactions must not
  // interleave BEGIN/savepoint/rollback across independent publications.
  private publicationTail: Promise<void> = Promise.resolve();
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
    // 2026-07-25 业主: "LED/背景音乐/投影默认不要自动播, 有人操作才播"。
    // 后端每次启动(开机/部署重启)把三路播放状态清空回待机 —— 重启后无人操作
    // 就该是待机。要放内容: 媒体页/播放控制台人为推送。
    await this.repo.update({ slot: In([1, 2, 3]) }, { playbackSession: null, currentMediaId: null, initiatorUserId: null, currentPlaylistId: null, paused: false });
    this.logger.info('[Playback] 启动即待机: 已清空三路播放状态 (业主要求默认不自动播)');
  }

  async list(actor?: Actor): Promise<PlaybackChannelView[]> {
    const rows = await this.repo.find({ order: { slot: 'ASC' } });
    return Promise.all(rows.map((r) => this.toView(r, actor)));
  }

  async getBySlot(slot: number, actor?: Actor): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    return this.toView(row, actor);
  }

  /**
   * 把媒体推到指定 slot.
   * - 更新 channel state (currentMediaId / startedAt / loopMode)
   * - WS 广播 playback_channel_changed
   * - PlayerPage 收到 WS 事件就切 <video> / <img>
   */
  async publishMedia(slot: number, mediaId: number, actor: Actor, opts: { loopMode?: 'once' | 'loop'; expectedSession?: string } = {}): Promise<PlaybackChannelView> {
    const release = this.mediaService.acquireOperation(mediaId);
    const previous = this.publicationTail;
    let releasePublication!: () => void;
    this.publicationTail = new Promise<void>(resolve => { releasePublication = resolve; });
    try {
      await previous;
      return await this.publishMediaLocked(slot, mediaId, actor, opts);
    } finally { releasePublication(); release(); }
  }

  private async publishMediaLocked(slot: number, mediaId: number, actor: Actor, opts: { loopMode?: 'once' | 'loop'; expectedSession?: string }): Promise<PlaybackChannelView> {
    assertCanUpload(actor);
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    // 校验媒体存在
    const m = await this.mediaService.get(mediaId).catch(() => null);
    if (!m) throw new BadRequestException(`媒体 ${mediaId} 不存在`);
    assertCanPublish(actor, m);
    if (m.kind === 'video' && m.processingStatus !== 'ready') {
      const detail = m.processingStatus === 'failed'
        ? `兼容转换失败: ${m.processingError || '请重试'}`
        : '正在生成兼容播放版本，请稍后再推送';
      throw new BadRequestException(detail);
    }

    // 展厅大屏默认循环: 播一遍就回待机等于要人守着重推, 现场没人干这事
    // (2026-07-16 业主: "没有人工干预就让它循环播放")
    const loopMode = opts.loopMode ?? 'loop';
    // 只写"推送新媒体"该动的这几个字段, 不整行 save —— 否则会把 playMode /
    // lastHeartbeatAt 这些不相干的字段一起写回旧值 (见 pause 上方注释)
    await serializedTransaction(this.repo.manager.connection, async manager => {
      let currentActor = actor;
      if (actor.userId !== null) {
        const user = await manager.findOneBy(User, { id: actor.userId });
        if (!user?.enabled) throw new ForbiddenException('账户已停用或不存在');
        currentActor = { ...actor, role: user.role, username: user.username };
      }
      const currentMedia = await manager.findOneBy(MediaAsset, { id: mediaId });
      if (!currentMedia) throw new NotFoundException('资料已不存在');
      assertCanPublish(currentActor, currentMedia);
      if (currentMedia.kind === 'video' && currentMedia.processingStatus !== 'ready') throw new ConflictException('资料处理状态已变化');
      const changed = await manager.update(PlaybackChannel, opts.expectedSession ? { slot, playbackSession: opts.expectedSession, paused: false } : { slot }, {
        playbackSession: randomUUID(),
        currentMediaId: mediaId,
        initiatorUserId: actor.userId,
        docPage: 1, // 新内容从第一页开始 (文档投屏)
        docZoom: 100, // 缩放回铺满
        currentPlaylistId: null,
        playlistIndex: 0,
        startedAt: new Date(),
        loopMode,
        paused: false,
      });
      if (!changed.affected) throw new ConflictException('播放会话已变化');

      // 通道与历史同事务提交，历史写入失败时不留下半次发布。
      await manager.save(PlaybackHistory, manager.create(PlaybackHistory, {
        slot, mediaId, ownerUserId: actor.userId, mediaName: currentMedia.originalName ?? `media ${mediaId}`,
      }));
      actor = currentActor;
    });

    const view = await this.getBySlot(slot, actor);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → media id=${mediaId} (${m.originalName}, loop=${loopMode})`);
    return view;
  }

  // ============ 欢迎页一键投放 (2026-07-28 业主: 输入源两页统一 + 指向明确) ============
  // 两种欢迎页, 按钮各自指向固定素材, 不再有"看设置猜播什么"的歧义:
  //   editable → 「金湖欢迎页·动态(称谓可编辑)」 (kind=webpage, 领导称谓在
  //              后台→系统品牌 编辑, 约 20s 自动生效) —— 两块屏共用一个网页素材,
  //              kiosk 按各自分辨率渲染。
  //   default  → 本屏专用尺寸的内置静态图 (slot1=LED版 / slot2=投影版), 不可编辑,
  //              作为兜底画面。
  // 素材是启动时自动入库的内置资源, 按 originalName 定位; 被改名/删除时报错并
  // 提示重启后端可自动重建 (seedBundledAssets 幂等)。
  static readonly WELCOME_EDITABLE_NAME = '金湖欢迎页·动态(称谓可编辑)';
  static readonly PARK_DASHBOARD_NAME = '金湖科创产业园·智慧运营总览(DEMO)';
  static readonly WELCOME_DEFAULT_NAMES: Record<number, string> = {
    1: '金湖欢迎页·LED大屏.png',
    2: '金湖欢迎页·投影.png',
  };

  async publishWelcome(slot: number, variant: 'editable' | 'default', actor: Actor): Promise<{ assetName: string; view: PlaybackChannelView }> {
    assertCanUpload(actor);
    const name = variant === 'editable'
      ? PlaybackService.WELCOME_EDITABLE_NAME
      : (PlaybackService.WELCOME_DEFAULT_NAMES[slot] ?? PlaybackService.WELCOME_DEFAULT_NAMES[1]);
    const media = await this.mediaService.findByOriginalName(name);
    if (!media) {
      throw new NotFoundException(`媒体库里找不到内置素材「${name}」(可能被改名或删除) — 重启后端会自动重建`);
    }
    const view = await this.publishMedia(slot, media.id, actor, { loopMode: 'loop' });
    return { assetName: name, view };
  }

  /** Direct input-source card for the built-in park operations dashboard. */
  async publishParkDashboard(slot: number, actor: Actor): Promise<{ assetName: string; view: PlaybackChannelView }> {
    assertCanUpload(actor);
    const name = PlaybackService.PARK_DASHBOARD_NAME;
    const media = await this.mediaService.findByOriginalName(name);
    if (!media) {
      throw new NotFoundException(`媒体库里找不到内置素材「${name}」— 请恢复内置网页投放源`);
    }
    const view = await this.publishMedia(slot, media.id, actor, { loopMode: 'loop' });
    return { assetName: name, view };
  }


  // Personal list CRUD lives in PersonalPlaylistService; no unscoped list access here.

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
  async step(slot: number, dir: 1 | -1, actor: Actor): Promise<PlaybackChannelView> {
    assertCanUpload(actor);
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    const list = await this.playablePlaylist(slot, actor);
    if (list.length === 0) throw new BadRequestException('播放列表是空的, 先把常播内容加进列表');

    const cur = list.findIndex((x) => x.mediaId === row.currentMediaId);
    let next: number;
    if (cur < 0) next = dir === 1 ? 0 : list.length - 1;
    else next = (cur + dir + list.length) % list.length;   // 环形, 到头绕回去

    return this.publishMedia(slot, list[next].mediaId, actor, { loopMode: row.loopMode as 'once' | 'loop' });
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
  async advance(slot: number, actor: Actor, expectedSession?: string): Promise<PlaybackChannelView> {
    assertCanUpload(actor);
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    const mode: PlaybackPlayMode = row.playMode ?? 'loopAll';
    if (expectedSession && row.playbackSession !== expectedSession) throw new ConflictException('播放会话已变化');
    const nextOptions = { loopMode: row.loopMode, expectedSession };

    // 单曲循环: 直接重播当前 (不看列表)
    if (mode === 'loop1' && row.currentMediaId !== null) {
      return this.publishMedia(slot, row.currentMediaId, actor, nextOptions);
    }

    const list = await this.playablePlaylist(slot, actor);

    // 列表空: 无从推进. 有当前曲就重播 (别让背景音乐彻底停), 否则不动.
    if (list.length === 0) {
      if (row.currentMediaId !== null) return this.publishMedia(slot, row.currentMediaId, actor, nextOptions);
      return this.toView(row);
    }

    const cur = list.findIndex((x) => x.mediaId === row.currentMediaId);

    if (mode === 'shuffle') {
      let pick = cur;
      if (list.length > 1) { while (pick === cur) pick = Math.floor(Math.random() * list.length); }
      else pick = 0;
      return this.publishMedia(slot, list[pick].mediaId, actor, nextOptions);
    }

    if (mode === 'seq') {
      if (cur < 0) return this.publishMedia(slot, list[0].mediaId, actor, nextOptions);
      if (cur >= list.length - 1) return this.stop(slot, expectedSession);
      return this.publishMedia(slot, list[cur + 1].mediaId, actor, nextOptions);
    }

    // loopAll (默认): 环形下一首
    const next = cur < 0 ? 0 : (cur + 1) % list.length;
    return this.publishMedia(slot, list[next].mediaId, actor, nextOptions);
  }

  private async playablePlaylist(slot: number, actor: Actor): Promise<PlaylistItem[]> {
    const rows = await this.plRepo.find({ where: visiblePlaylistWhere(actor, slot), order: { sortOrder: 'ASC', id: 'ASC' } });
    const visible: PlaylistItem[] = [];
    for (const row of rows) {
      const media = await this.mediaService.get(row.mediaId).catch(() => null);
      if (media && canReadResource(actor, media)) visible.push(row);
    }
    return visible;
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
  async listHistory(slot: number, actor: Actor, limit = 20): Promise<Array<{
    mediaId: number; mediaName: string; playedAt: Date; missing: boolean; ownerUserId: number | null;
  }>> {
    if (!Number.isInteger(slot) || slot < 1 || slot > 3 || !Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new BadRequestException('无效历史查询范围');
    }
    return serializedTransaction(this.hisRepo.manager.connection, async manager => {
      let current = actor;
      if (actor.userId !== null) {
        const user = await manager.findOneBy(User, { id: actor.userId, enabled: true });
        if (!user) throw new ForbiddenException('账户已停用');
        current = { ...actor, role: user.role };
      }
      const rows = await manager.find(PlaybackHistory, { where: current.role === 'admin' ? { slot } : { slot, ownerUserId: current.userId ?? IsNull() }, order: { playedAt: 'DESC', id: 'DESC' }, take: 200 });
      const seen = new Set<string>();
      const out = [];
      for (const r of rows) {
        const key = `${r.ownerUserId}:${r.mediaId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const m = await manager.findOneBy(MediaAsset, { id: r.mediaId });
        if (m && !canReadResource(current, m)) continue;
        out.push({ mediaId: r.mediaId, ownerUserId: r.ownerUserId, mediaName: m?.originalName ?? r.mediaName, playedAt: r.playedAt, missing: !m });
        if (out.length >= limit) break;
      }
      return out;
    });
  }

  /** 清掉当前播放, 回到待机 (PlayerPage 显示 logo + 系统名称) */
  async stop(slot: number, expectedSession?: string, requirePlaying = true): Promise<PlaybackChannelView> {
    // 只清播放状态相关字段, 不碰 playMode / lastHeartbeatAt (见 pause 上方注释)
    const res = await this.repo.update(expectedSession ? { slot, playbackSession: expectedSession, ...(requirePlaying ? { paused: false } : {}) } : { slot }, {
      playbackSession: null,
      currentMediaId: null,
      initiatorUserId: null,
      currentPlaylistId: null,
      playlistIndex: 0,
      startedAt: null,
      paused: false,
    });
    if (!res.affected) {
      if (expectedSession) throw new ConflictException('播放会话已变化');
      throw new NotFoundException(`slot=${slot} 不存在`);
    }

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

  /** 文档翻页 (2026-07-25): clamp 到 [1, pageCount]; WS 广播 — 守护(PPT)/kiosk(Word) 跟随 */
  async setDocPage(slot: number, page: number, expectedSession?: string): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    if (expectedSession !== undefined && row.playbackSession !== expectedSession) throw new ConflictException('播放会话已变化，请刷新后翻页');
    let max = Number.MAX_SAFE_INTEGER;
    if (row.currentMediaId) {
      const m = await this.mediaService.get(row.currentMediaId).catch(() => null);
      if (m?.pageCount) max = m.pageCount;
    }
    const changed = await this.repo.update({
      slot, playbackSession: row.playbackSession ?? IsNull(), currentMediaId: row.currentMediaId ?? IsNull(),
    }, { docPage: Math.max(1, Math.min(Math.floor(page) || 1, max)) });
    if (!changed.affected) throw new ConflictException('播放会话已变化，请刷新后翻页');
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    return view;
  }

  /** 文档画面缩放 (2026-07-29 业主: PPT 要能全屏/放大缩小)。50-200 夹取, 100=铺满 */
  async setDocZoom(slot: number, zoom: number, expectedSession?: string): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    if (expectedSession !== undefined && row.playbackSession !== expectedSession) throw new ConflictException('播放会话已变化，请刷新后缩放');
    const changed = await this.repo.update({
      slot, playbackSession: row.playbackSession ?? IsNull(), currentMediaId: row.currentMediaId ?? IsNull(),
    }, { docZoom: Math.max(50, Math.min(Math.round(zoom) || 100, 200)) });
    if (!changed.affected) throw new ConflictException('播放会话已变化，请刷新后缩放');
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    return view;
  }

  /** 画面铺放模式 (fill/contain/cover) — WS 广播, kiosk 即时生效, 状态持久 */
  async setDisplayFit(slot: number, fit: PlaybackDisplayFit): Promise<PlaybackChannelView> {
    const res = await this.repo.update({ slot }, { displayFit: fit });
    if (!res.affected) throw new NotFoundException(`slot=${slot} 不存在`);
    const view = await this.getBySlot(slot);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} displayFit=${fit}`);
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

  private async toView(row: PlaybackChannel, actor?: Actor): Promise<PlaybackChannelView> {
    let readable = false;
    let mediaName: string | null = null;
    let mediaKind: 'video' | 'image' | 'audio' | 'webpage' | 'doc' | null = null;
    let mediaUrl: string | null = null;
    let durationSec: number | null = null;
    let pageCount: number | null = null;
    if (row.currentMediaId !== null) {
      const m = await this.mediaService.get(row.currentMediaId).catch(() => null);
      if (m && actor && canReadResource(actor, m)) {
        readable = true;
        mediaName = m.originalName;
        mediaKind = m.kind;
        // webpage 用外部 URL; doc: Word 有转好的 PDF 给 kiosk 逐页渲染,
        // PPT 走 PowerPoint 原生放映 (kiosk 只显示占位) → url=null
        if (m.kind === 'webpage') mediaUrl = m.sourceUrl;
        else if (m.kind === 'doc') mediaUrl = m.docPdfPath ? `/api/media/${m.id}/file?variant=pdf` : null;
        else mediaUrl = `/api/media/${m.id}/file`;
        durationSec = m.durationSec;
        pageCount = m.pageCount;
      }
    }
    const alive = row.lastHeartbeatAt
      ? Date.now() - row.lastHeartbeatAt.getTime() < HEARTBEAT_STALE_MS
      : false;
    return {
      occupied: row.currentMediaId !== null,
      playbackSession: readable ? row.playbackSession : null,
      restricted: row.currentMediaId !== null && !readable,
      id: row.id,
      slot: row.slot,
      name: row.name,
      outputKind: row.outputKind,
      currentMediaId: readable ? row.currentMediaId : null,
      currentMediaName: mediaName,
      currentMediaKind: mediaKind,
      currentMediaUrl: mediaUrl,
      currentMediaDurationSec: durationSec,
      currentPlaylistId: readable ? row.currentPlaylistId : null,
      playlistIndex: readable ? row.playlistIndex : 0,
      displayFit: (row.displayFit ?? 'fill') as PlaybackDisplayFit,
      docPage: readable ? row.docPage ?? 1 : 1,
      docZoom: row.docZoom ?? 100,
      currentMediaPageCount: pageCount,
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
      at: new Date().toISOString(),
    });
  }
}
