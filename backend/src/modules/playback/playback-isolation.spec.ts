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
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test', role: 'operator' }, { id: 2, username: 'bob', password: 'test', role: 'operator' }]);
    await db.getRepository(PlaybackChannel).save({ slot: 1, name: 'Test LED', outputKind: 'led' });
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    service = new PlaybackService(db.getRepository(PlaybackChannel), db.getRepository(PlaylistItem), db.getRepository(PlaybackHistory), media, { publish: jest.fn() } as any, { info: jest.fn() } as any);
    aliceId = (await media.createWebpage('Alice private', 'https://example.test/a', alice)).id;
    bobId = (await media.createWebpage('Bob private', 'https://example.test/b', bob)).id;
    await db.getRepository(PlaylistItem).save([{ slot: 1, mediaId: aliceId, ownerUserId: 1 }, { slot: 1, mediaId: bobId, ownerUserId: 2 }]);
  });
  afterEach(async () => { await db.destroy(); });
  it('rejects document controls carrying a previous session even before the server lookup', async () => {
    const first = await service.publishMedia(1, aliceId, alice);
    expect(first.playbackSession).toEqual(expect.any(String));
    expect((await service.getBySlot(1, bob)).playbackSession).toBeNull();
    const next = await service.publishMedia(1, aliceId, alice);
    expect(next.playbackSession).not.toBe(first.playbackSession);
    await expect(service.setDocPage(1, 2, first.playbackSession!)).rejects.toThrow('播放会话已变化');
    await expect(service.setDocZoom(1, 150, first.playbackSession!)).rejects.toThrow('播放会话已变化');
    await service.setDocZoom(1, 150, next.playbackSession!);
    expect((await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).docZoom).toBe(150);
  });
  it.each(['page', 'zoom'])('rejects stale document %s changes instead of restoring a replaced channel', async control => {
    await service.publishMedia(1, aliceId, alice);
    const repo = db.getRepository(PlaybackChannel), findOne = repo.findOne.bind(repo);
    jest.spyOn(repo, 'findOne').mockImplementationOnce(async options => {
      const old = await findOne(options);
      await repo.update({ slot: 1 }, { currentMediaId: bobId, initiatorUserId: 2, playbackSession: 'new-session', docPage: 1, docZoom: 100, paused: true });
      return old;
    });
    await expect(control === 'page' ? service.setDocPage(1, 3) : service.setDocZoom(1, 150)).rejects.toThrow('播放会话已变化');
    expect(await repo.findOneByOrFail({ slot: 1 })).toMatchObject({
      currentMediaId: bobId, initiatorUserId: 2, playbackSession: 'new-session', docPage: 1, docZoom: 100, paused: true,
    });
  });
  it('document controls change only their fields and respect page/zoom bounds', async () => {
    await db.getRepository(MediaAsset).update(aliceId, { pageCount: 4 });
    await service.publishMedia(1, aliceId, alice);
    await db.getRepository(PlaybackChannel).update({ slot: 1 }, { paused: true });
    await service.setDocPage(1, 99);
    await service.setDocZoom(1, 500);
    expect(await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).toMatchObject({
      currentMediaId: aliceId, initiatorUserId: 1, paused: true, docPage: 4, docZoom: 200,
    });
  });
  it('commits simultaneous independent channel publications without transaction nesting', async () => {
    await db.getRepository(PlaybackChannel).save({ slot: 2, name: 'Test projector', outputKind: 'projector' });
    for (let round = 0; round < 3; round++) {
      const results = await Promise.allSettled([service.publishMedia(1, aliceId, alice), service.publishMedia(2, bobId, bob)]);
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'fulfilled']);
    }
    expect(await db.getRepository(PlaybackHistory).count()).toBe(6);
    expect((await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).currentMediaId).toBe(aliceId);
    expect((await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 2 })).currentMediaId).toBe(bobId);
  });
  it('keeps concurrent channels independent when one history write fails', async () => {
    await db.getRepository(PlaybackChannel).save({ slot: 2, name: 'Test projector', outputKind: 'projector' });
    await db.query("CREATE TRIGGER fail_second_history BEFORE INSERT ON playback_history WHEN NEW.slot = 2 BEGIN SELECT RAISE(ABORT, 'second history unavailable'); END");
    const results = await Promise.allSettled([
      service.publishMedia(1, aliceId, alice), service.publishMedia(2, bobId, bob),
    ]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    const first = await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 });
    const second = await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 2 });
    expect(first.currentMediaId).toBe(aliceId);
    expect(second.currentMediaId).toBeNull();
    expect((await db.getRepository(PlaybackHistory).find()).map(row => row.slot)).toEqual([1]);
    await db.query('DROP TRIGGER fail_second_history');
    await service.publishMedia(2, bobId, bob);
    expect(await db.getRepository(PlaybackHistory).count()).toBe(2);
  });
  it.each(['disabled', 'viewer', 'deleted'])('rejects an actor made %s after the request began', async state => {
    const get = media.get.bind(media);
    jest.spyOn(media, 'get').mockImplementationOnce(async id => {
      const asset = await get(id);
      if (state === 'deleted') await db.getRepository(User).delete(alice.userId!);
      else await db.getRepository(User).update(alice.userId!, state === 'disabled' ? { enabled: false } : { role: 'viewer' });
      return asset;
    });
    await expect(service.publishMedia(1, aliceId, alice)).rejects.toThrow();
    expect((await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 })).currentMediaId).toBeNull();
    expect(await db.getRepository(PlaybackHistory).count()).toBe(0);
  });
  it('rolls back channel and session when history persistence fails', async () => {
    await service.publishMedia(1, aliceId, alice);
    const before = await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 });
    await db.query("CREATE TRIGGER fail_history BEFORE INSERT ON playback_history BEGIN SELECT RAISE(ABORT, 'history unavailable'); END");
    await expect(service.publishMedia(1, bobId, bob)).rejects.toThrow('history unavailable');
    const after = await db.getRepository(PlaybackChannel).findOneByOrFail({ slot: 1 });
    expect(after).toEqual(before);
    expect(await db.getRepository(PlaybackHistory).count()).toBe(1);
  });
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
