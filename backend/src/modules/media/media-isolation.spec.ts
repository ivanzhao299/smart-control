import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { MediaAsset } from '../../entities/media-asset.entity';
import { User } from '../../entities/user.entity';
import type { Actor } from '../../common/auth/actor';

describe('media isolation with SQLite repositories', () => {
  let db: DataSource;
  let media: MediaService;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [MediaAsset, User], synchronize: true }).initialize();
    await db.getRepository(User).save([
      { id: 1, username: 'alice', password: 'test', role: 'operator' },
      { id: 2, username: 'bob', password: 'test', role: 'operator' },
    ]);
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    await media.createWebpage('Alice private', 'https://example.test/alice', alice);
    await media.createWebpage('Bob private', 'https://example.test/bob', bob);
    const shared = await media.createWebpage('Public', 'https://example.test/public', admin);
    await db.getRepository(MediaAsset).update(shared.id, { visibility: 'shared' });
  });
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });
  it('filters before pagination and count, not after returning all data', async () => {
    const a = await media.list({ actor: alice, limit: 1 });
    expect(a.total).toBe(2);
    expect(a.items).toHaveLength(1);
    const b = await media.list({ actor: bob });
    expect(b.items.map(x => x.originalName).sort()).toEqual(['Bob private', 'Public']);
    expect((await media.list({ actor: admin })).total).toBe(3);
  });
  it('checks direct IDs even when lists are bypassed', async () => {
    const item = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Alice private' });
    await expect(media.authorized(item.id, bob)).rejects.toThrow('资料不存在');
    await expect(media.authorized(item.id, bob, true)).rejects.toThrow('资料不存在');
    expect((await media.authorized(item.id, alice)).ownerUserId).toBe(1);
    expect((await media.authorized(item.id, admin, true)).id).toBe(item.id);
  });
  it('legacy users only see shared resources; viewers cannot create', async () => {
    const legacy: Actor = { kind: 'legacy', userId: null, username: 'legacy', role: 'viewer' };
    expect((await media.list({ actor: legacy })).items.map(x => x.originalName)).toEqual(['Public']);
    await expect(media.createWebpage('Denied', 'https://example.test', legacy)).rejects.toThrow();
    await expect(media.createWebpage('Denied', 'https://example.test', { ...alice, role: 'viewer' })).rejects.toThrow();
  });

  it('prevents publishing ownership changes by users and permits admin reassignment', async () => {
    const item = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Alice private' });
    await expect(media.updateOwned(item.id, alice, { visibility: 'shared' })).rejects.toThrow();
    await expect(media.updateOwned(item.id, alice, { ownerUserId: 2 })).rejects.toThrow();
    await expect(media.updateOwned(item.id, admin, { ownerUserId: 999 })).rejects.toThrow();
    await media.updateOwned(item.id, alice, { remark: 'My note' });
    await media.updateOwned(item.id, admin, { ownerUserId: 2 });
    await expect(media.authorized(item.id, alice)).rejects.toThrow();
    expect((await media.authorized(item.id, bob)).remark).toBe('My note');
  });
});
