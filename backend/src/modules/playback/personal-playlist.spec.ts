import 'reflect-metadata';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MediaAsset } from '../../entities/media-asset.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { User } from '../../entities/user.entity';
import { Actor } from '../../common/auth/actor';
import { MediaService } from '../media/media.service';
import { PersonalPlaylistService } from './personal-playlist.service';

describe('personal playlists', () => {
  let db: DataSource, service: PersonalPlaylistService, media: MediaService, sharedId: number;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [MediaAsset, PlaylistItem, User], synchronize: true }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test', role: 'operator' }, { id: 2, username: 'bob', password: 'test', role: 'operator' }]);
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    sharedId = (await media.createWebpage('Public', 'https://example.test', admin)).id;
    await db.getRepository(MediaAsset).update(sharedId, { visibility: 'shared' });
    service = new PersonalPlaylistService(db.getRepository(PlaylistItem), media);
  });
  afterEach(async () => { await db.destroy(); });
  it.each(['disabled', 'demoted'])('rejects queued all-user reads after administrator revocation: %s', async state => {
    await service.add(bob, 1, sharedId, 'Bob private title');
    await db.getRepository(User).update(1, { role: 'admin' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held;
      await manager.update(User, 1, state === 'disabled' ? { enabled: false } : { role: 'viewer' });
    });
    await ready;
    let settled = false;
    const reading = service.list({ ...alice, role: 'admin' }, 1, 'all').finally(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    expect((await Promise.allSettled([writer, reading])).map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    if (state === 'demoted') {
      expect(await service.list({ ...alice, role: 'admin' }, 1)).toEqual([]);
      expect(await service.list({ ...alice, role: 'viewer' }, 1, 'shared')).toEqual([]);
    }
  });
  it('allows independent entries for one shared asset and hides other owners', async () => {
    const a = await service.add(alice, 1, sharedId, 'Alice title');
    const b = await service.add(bob, 1, sharedId, 'Bob title');
    await service.add(admin, 1, sharedId, 'Legacy public');
    expect(a.id).not.toBe(b.id);
    expect(await service.add(alice, 1, sharedId)).toEqual(a);
    expect((await service.list(alice, 1)).map(x => x.title)).toEqual(['Alice title']);
    expect((await service.list(bob, 1, 'shared')).map(x => x.title)).toEqual(['Legacy public']);
    expect(await service.list(admin, 1, 'all')).toHaveLength(3);
    await expect(service.list(bob, 1, 'all')).rejects.toThrow();
  });
  it('rejects direct ID modifications and cross-owner or cross-slot reorder', async () => {
    const a = await service.add(alice, 1, sharedId);
    const b = await service.add(bob, 1, sharedId);
    await expect(service.rename(bob, a.id, 'stolen')).rejects.toThrow();
    await expect(service.remove(bob, a.id)).rejects.toThrow();
    await expect(service.reorder(bob, 1, [b.id, a.id])).rejects.toThrow();
    await expect(service.reorder(admin, 1, [b.id, a.id])).rejects.toThrow();
    await expect(service.reorder(alice, 2, [a.id])).rejects.toThrow();
    await expect(service.reorder(alice, 1, [a.id, a.id])).rejects.toThrow();
    await service.rename(alice, a.id, 'mine');
    expect((await service.list(alice, 1))[0].title).toBe('mine');
  });
  it('checks media permissions on add and again when ownership changes', async () => {
    const privateId = (await media.createWebpage('Private', 'https://example.test', alice)).id;
    await expect(service.add(bob, 1, privateId)).rejects.toThrow();
    await service.add(alice, 1, privateId);
    await media.updateOwned(privateId, admin, { ownerUserId: 2 });
    expect(await service.list(alice, 1)).toEqual([]);
  });
  it('rejects viewers, legacy writes and invalid scopes', async () => {
    await expect(service.add({ ...alice, role: 'viewer' }, 1, sharedId)).rejects.toThrow();
    await expect(service.add({ kind: 'legacy', userId: null, username: 'legacy', role: 'viewer' }, 1, sharedId)).rejects.toThrow();
    await expect(service.list(alice, 0)).rejects.toThrow();
    await expect(service.list(alice, 1, 'invalid' as any)).rejects.toThrow();
  });
  it('does not resurrect an item deleted while rename waits for the transaction queue', async () => {
    const item = await service.add(alice, 1, sharedId);
    const repo = db.getRepository(PlaylistItem);
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held; await manager.delete(PlaylistItem, item.id);
    });
    await ready;
    const renamed = service.rename(alice, item.id, 'late rename');
    finish();
    expect((await Promise.allSettled([writer, renamed])).map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await repo.count()).toBe(0);
  });
  it.each(['disabled', 'viewer'])('rechecks all queued playlist writes after account revocation: %s', async state => {
    const item = await service.add(alice, 1, sharedId, 'original');
    const before = await db.getRepository(PlaylistItem).find();
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held;
      await manager.update(User, 1, state === 'disabled' ? { enabled: false } : { role: 'viewer' });
    });
    await ready;
    let settled = 0;
    const operations = [service.add(alice, 2, sharedId), service.rename(alice, item.id, 'changed'),
      service.remove(alice, item.id), service.reorder(alice, 1, [item.id])].map(pending => pending.finally(() => { settled++; }));
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(0);
    finish();
    const results = await Promise.allSettled([writer, ...operations]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected', 'rejected', 'rejected', 'rejected']);
    expect(await db.getRepository(PlaylistItem).find()).toEqual(before);
    media.acquireOperation(sharedId)();
  });
  it('refuses adding references while the asset lifecycle is locked', async () => {
    const release = media.acquireOperation(sharedId);
    try { await expect(service.add(alice, 1, sharedId)).rejects.toThrow('正在使用'); }
    finally { release(); }
    expect(await db.getRepository(PlaylistItem).count()).toBe(0);
    await service.add(alice, 1, sharedId);
  });
});
