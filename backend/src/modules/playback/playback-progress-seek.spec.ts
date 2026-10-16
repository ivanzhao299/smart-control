import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MediaAsset } from '../../entities/media-asset.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { User } from '../../entities/user.entity';
import { Actor } from '../../common/auth/actor';
import { MediaService } from '../media/media.service';
import { PlaybackService } from './playback.service';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { LinkUploadMedia1788618006000 } from '../../migrations/1788618006000-LinkUploadMedia';

describe('playback loop mode / progress / seek', () => {
  let db: DataSource;
  let service: PlaybackService;
  let media: MediaService;
  let bus: { publish: jest.Mock };
  const operator: Actor = { kind: 'user', userId: 1, username: 'op', role: 'operator' };

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [MediaAsset, PlaylistItem, PlaybackChannel, PlaybackHistory, User],
      synchronize: true,
    }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await new LinkUploadMedia1788618006000().up(db.createQueryRunner());
    await db.getRepository(User).save({ id: 1, username: 'op', password: 'test', role: 'operator' });
    await db.getRepository(PlaybackChannel).save({ slot: 1, name: 'Test LED', outputKind: 'led' });
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as never);
    bus = { publish: jest.fn() };
    service = new PlaybackService(
      db.getRepository(PlaybackChannel),
      db.getRepository(PlaylistItem),
      db.getRepository(PlaybackHistory),
      media,
      bus as never,
      { info: jest.fn() } as never,
    );
  });

  afterEach(async () => { await db.destroy(); });

  async function publishVideo(durationSec = 100): Promise<number> {
    const video = await db.getRepository(MediaAsset).save({
      ownerUserId: 1,
      originalName: 'demo.mp4',
      safeName: 'demo.mp4',
      path: '/tmp/demo.mp4',
      kind: 'video',
      mimeType: 'video/mp4',
      sizeBytes: 1000,
      durationSec,
      processingStatus: 'ready',
    });
    await service.publishMedia(1, video.id, operator);
    return video.id;
  }

  it('普通媒体推送默认单次 (once)', async () => {
    const id = await media.createWebpage('页面', 'https://example.test', operator).then(m => m.id);
    await service.publishMedia(1, id, operator);
    await expect(service.getBySlot(1)).resolves.toMatchObject({ loopMode: 'once' });
  });

  it('setLoopMode 持久化并广播 channel_changed, 非法值拒绝', async () => {
    await service.setLoopMode(1, 'loop');
    await expect(service.getBySlot(1)).resolves.toMatchObject({ loopMode: 'loop' });
    expect(bus.publish).toHaveBeenCalledWith(expect.objectContaining({ type: 'playback_channel_changed', slot: 1 }));
    await expect(service.setLoopMode(1, 'bogus' as never)).rejects.toThrow('once');
  });

  it('idle 或非视频时 seek 被拒绝', async () => {
    await expect(service.seek(1, 5)).rejects.toThrow('没有在播放');
    const webpageId = await media.createWebpage('页面', 'https://example.test', operator).then(m => m.id);
    await service.publishMedia(1, webpageId, operator);
    await expect(service.seek(1, 5)).rejects.toThrow('视频');
  });

  it('seek 越界自动夹到时长, nonce 单调递增, 并下发 playback_seek', async () => {
    await publishVideo(100);
    // 大屏上报的实时 duration(120) 优先于媒体元数据(100)
    service.reportProgress(1, { currentTime: 0, duration: 120, paused: false, ended: false, mediaId: 1 });
    const r1 = await service.seek(1, 500);
    expect(r1.time).toBe(120);
    expect(r1.nonce).toBe(1);
    const r2 = await service.seek(1, 10);
    expect(r2.time).toBe(10);
    expect(r2.nonce).toBe(2);
    const seekEvent = bus.publish.mock.calls
      .map(c => c[0])
      .find(e => e.type === 'playback_seek' && e.nonce === 1);
    expect(seekEvent).toMatchObject({ type: 'playback_seek', slot: 1, time: 120 });
  });

  it('没有实时 duration 时 seek 兜底夹到媒体元数据时长', async () => {
    await publishVideo(100);
    await expect(service.seek(1, 999)).resolves.toMatchObject({ time: 100 });
    await expect(service.seek(1, -1)).rejects.toThrow('秒数');
  });

  it('reportProgress 落内存并广播, 非 ended 500ms 内节流, ended 立即广播', async () => {
    service.reportProgress(1, { currentTime: 1, duration: 120, paused: false, ended: false, mediaId: 7 });
    service.reportProgress(1, { currentTime: 1.2, duration: 120, paused: false, ended: false, mediaId: 7 });
    let progressEvents = bus.publish.mock.calls.map(c => c[0]).filter(e => e.type === 'playback_progress');
    expect(progressEvents).toHaveLength(1);
    expect(progressEvents[0]).toMatchObject({ slot: 1, currentTime: 1, duration: 120, ended: false });

    // 播完停尾帧立即广播, 不受节流限制
    service.reportProgress(1, { currentTime: 120, duration: 120, paused: false, ended: true, mediaId: 7 });
    progressEvents = bus.publish.mock.calls.map(c => c[0]).filter(e => e.type === 'playback_progress');
    expect(progressEvents).toHaveLength(2);
    expect(progressEvents[1]).toMatchObject({ ended: true, currentTime: 120 });
  });
});
