import 'reflect-metadata';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
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

describe('playback ownership', () => {
  let db: DataSource, service: PlaybackService, media: MediaService;
  let aliceId: number, bobId: number;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [MediaAsset, PlaylistItem, PlaybackChannel, PlaybackHistory, User], synchronize: true }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test' }, { id: 2, username: 'bob', password: 'test' }]);
    await db.getRepository(PlaybackChannel).save({ slot: 1, name: 'Test LED', outputKind: 'led' });
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    service = new PlaybackService(db.getRepository(PlaybackChannel), db.getRepository(PlaylistItem), db.getRepository(PlaybackHistory), media, { publish: jest.fn() } as any, { info: jest.fn() } as any);
    aliceId = (await media.createWebpage('Alice private', 'https://example.test/a', alice)).id;
    bobId = (await media.createWebpage('Bob private', 'https://example.test/b', bob)).id;
    await db.getRepository(PlaylistItem).save([{ slot: 1, mediaId: aliceId, ownerUserId: 1 }, { slot: 1, mediaId: bobId, ownerUserId: 2 }]);
  });
  afterEach(async () => { await db.destroy(); });
  it('records real publisher and rejects private-ID and viewer publishing', async () => {
    await expect(service.publishMedia(1, aliceId, bob)).rejects.toThrow();
    await expect(service.publishMedia(1, aliceId, { ...alice, role: 'viewer' })).rejects.toThrow();
    expect(await db.getRepository(PlaybackHistory).count()).toBe(0);
    await service.publishMedia(1, aliceId, alice);
    expect((await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).initiatorUserId).toBe(1);
    expect((await db.getRepository(PlaybackHistory).find())[0].ownerUserId).toBe(1);
  });
  it('selects only the acting user playlist for manual steps', async () => {
    await service.publishMedia(1, bobId, bob);
    expect((await service.step(1, 1, alice)).currentMediaId).toBe(aliceId);
    expect((await service.step(1, -1, bob)).currentMediaId).toBe(bobId);
    await media.updateOwned(aliceId, admin, { ownerUserId: 2 });
    await expect(service.step(1, 1, alice)).rejects.toThrow('播放列表是空的');
  });
  it('filters history before limiting and never merges different publishers', async () => {
    await service.publishMedia(1, aliceId, alice);
    await service.publishMedia(1, bobId, bob);
    expect((await service.listHistory(1, alice, 1)).map(x => x.mediaId)).toEqual([aliceId]);
    expect((await service.listHistory(1, bob)).map(x => x.mediaId)).toEqual([bobId]);
    expect(await service.listHistory(1, admin)).toHaveLength(2);
    await media.updateOwned(aliceId, admin, { ownerUserId: 2 });
    expect(await service.listHistory(1, alice)).toEqual([]);
  });
  it('will not replay another user private current media during loop1', async () => {
    await service.publishMedia(1, bobId, bob);
    await db.getRepository(PlaybackChannel).update({ slot: 1 }, { playMode: 'loop1' });
    await expect(service.advance(1, alice)).rejects.toThrow();
    expect((await service.advance(1, bob)).currentMediaId).toBe(bobId);
  });
  it('redacts private channel metadata and emits invalidations without content', async () => {
    const events: unknown[] = [];
    service = new PlaybackService(db.getRepository(PlaybackChannel), db.getRepository(PlaylistItem), db.getRepository(PlaybackHistory), media, { publish: (e: unknown) => events.push(e) } as any, { info: jest.fn() } as any);
    await service.publishMedia(1, aliceId, alice);
    const hidden = await service.getBySlot(1, bob);
    expect(hidden).toMatchObject({ occupied: true, restricted: true, currentMediaId: null, currentMediaName: null, currentMediaUrl: null, currentMediaKind: null, currentMediaPageCount: null, currentMediaDurationSec: null });
    expect(JSON.stringify(hidden)).not.toContain('example.test');
    expect((await service.getBySlot(1)).restricted).toBe(true);
    expect((await service.getBySlot(1, alice)).currentMediaName).toBe('Alice private');
    expect((await service.getBySlot(1, admin)).currentMediaId).toBe(aliceId);
    expect(events).toEqual([{ type: 'playback_channel_changed', slot: 1, at: expect.any(String) }]);
    await media.updateOwned(aliceId, admin, { ownerUserId: 2 });
    expect((await service.getBySlot(1, alice)).restricted).toBe(true);
    expect((await service.getBySlot(1, bob)).restricted).toBe(false);
  });
  it('atomically accepts one completion event and rejects stale publish/stop', async () => {
    await service.publishMedia(1, aliceId, alice);
    const session = (await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).playbackSession!;
    const results = await Promise.allSettled([service.advance(1, alice, session), service.advance(1, alice, session)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
    expect(await db.getRepository(PlaybackHistory).count()).toBe(2);
    await service.publishMedia(1, bobId, bob);
    await expect(service.stop(1, session)).rejects.toThrow('播放会话已变化');
    await expect(service.publishMedia(1, aliceId, alice, { expectedSession: session })).rejects.toThrow('播放会话已变化');
    expect((await service.getBySlot(1, bob)).currentMediaId).toBe(bobId);
  });
});
