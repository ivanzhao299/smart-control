import 'reflect-metadata';
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
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test' }, { id: 2, username: 'bob', password: 'test' }]);
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    sharedId = (await media.createWebpage('Public', 'https://example.test', admin)).id;
    await db.getRepository(MediaAsset).update(sharedId, { visibility: 'shared' });
    service = new PersonalPlaylistService(db.getRepository(PlaylistItem), media);
  });
  afterEach(async () => { await db.destroy(); });
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
  it('does not resurrect an item deleted after rename read', async () => {
    const item = await service.add(alice, 1, sharedId);
    const repo = db.getRepository(PlaylistItem);
    const snapshot = await repo.findOneByOrFail({ id: item.id });
    const read = jest.spyOn(repo, 'findOneBy').mockImplementationOnce(async () => {
      await repo.delete(item.id);
      return snapshot;
    });
    try {
      await expect(service.rename(alice, item.id, 'late rename')).rejects.toThrow('已删除');
      expect(await repo.count()).toBe(0);
    } finally { read.mockRestore(); }
  });
  it('refuses adding references while the asset lifecycle is locked', async () => {
    const release = media.acquireOperation(sharedId);
    try { await expect(service.add(alice, 1, sharedId)).rejects.toThrow('正在使用'); }
    finally { release(); }
    expect(await db.getRepository(PlaylistItem).count()).toBe(0);
    await service.add(alice, 1, sharedId);
  });
});
