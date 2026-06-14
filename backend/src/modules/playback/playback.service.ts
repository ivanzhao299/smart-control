import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { MediaService } from '../media/media.service';
import { ControlBus } from '../../services/control-bus';

export interface PlaybackChannelView {
  id: number;
  slot: number;
  name: string;
  outputKind: 'led' | 'projector' | 'monitor' | 'audio';
  currentMediaId: number | null;
  currentMediaName: string | null;
  currentMediaKind: 'video' | 'image' | 'audio' | null;
  currentMediaUrl: string | null;     // 前端 PlayerPage 直接 <video src=> / <img src=> 用
  currentMediaDurationSec: number | null;
  currentPlaylistId: number | null;
  playlistIndex: number;
  startedAt: string | null;
  loopMode: 'once' | 'loop';
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

    row.currentMediaId = mediaId;
    row.currentPlaylistId = null;
    row.playlistIndex = 0;
    row.startedAt = new Date();
    row.loopMode = opts.loopMode ?? 'once';
    await this.repo.save(row);

    const view = await this.toView(row);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → media id=${mediaId} (${m.originalName}, loop=${row.loopMode})`);
    return view;
  }

  /** 清掉当前播放, 回到待机 (PlayerPage 显示 logo + 系统名称) */
  async stop(slot: number): Promise<PlaybackChannelView> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    row.currentMediaId = null;
    row.currentPlaylistId = null;
    row.playlistIndex = 0;
    row.startedAt = null;
    await this.repo.save(row);

    const view = await this.toView(row);
    this.broadcast(view);
    this.logger.info(`[Playback] slot=${slot} → idle`);
    return view;
  }

  /** PlayerPage 心跳 — 证明 kiosk 还活着. 超过 HEARTBEAT_STALE_MS 没收到就 alive=false */
  async heartbeat(slot: number): Promise<void> {
    const row = await this.repo.findOne({ where: { slot } });
    if (!row) throw new NotFoundException(`slot=${slot} 不存在`);
    row.lastHeartbeatAt = new Date();
    await this.repo.save(row);
    // 心跳不广播 WS, 太频繁; 前端要看 PlayerPage 活没活直接 GET /api/playback
  }

  private async toView(row: PlaybackChannel): Promise<PlaybackChannelView> {
    let mediaName: string | null = null;
    let mediaKind: 'video' | 'image' | 'audio' | null = null;
    let mediaUrl: string | null = null;
    let durationSec: number | null = null;
    if (row.currentMediaId !== null) {
      const m = await this.mediaService.get(row.currentMediaId).catch(() => null);
      if (m) {
        mediaName = m.originalName;
        mediaKind = m.kind;
        // PlayerPage 直接拿这个 URL 当 <video src>, 走相同 host (vite preview / nginx)
        mediaUrl = `/api/media/${m.id}/file`;
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
