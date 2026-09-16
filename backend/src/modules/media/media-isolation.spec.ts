import 'reflect-metadata';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { LinkUploadMedia1788618006000 } from '../../migrations/1788618006000-LinkUploadMedia';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { MediaService } from './media.service';
import { MediaAsset } from '../../entities/media-asset.entity';
import { User } from '../../entities/user.entity';
import type { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

describe('media isolation with SQLite repositories', () => {
  let db: DataSource;
  let media: MediaService;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [MediaAsset, User], synchronize: true }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await new LinkUploadMedia1788618006000().up(db.createQueryRunner());
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
  it.each(['disabled', 'demoted'])('rechecks direct media authorization after queued administrator revocation: %s', async state => {
    const target = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Bob private' });
    await db.getRepository(User).update(1, { role: 'admin' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held;
      await manager.update(User, 1, state === 'disabled' ? { enabled: false } : { role: 'viewer' });
    });
    await ready;
    let settled = 0;
    const operations = [false, true].map(write => media.authorized(target.id, { ...alice, role: 'admin' }, write).finally(() => { settled++; }));
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(0);
    finish();
    expect((await Promise.allSettled([writer, ...operations])).map(result => result.status)).toEqual(['fulfilled', 'rejected', 'rejected']);
  });
  it.each(['disabled', 'demoted'])('rechecks queued media listing after administrator revocation: %s', async state => {
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
    const staleAdmin = { ...alice, role: 'admin' } as Actor;
    const reading = media.list({ actor: staleAdmin }).finally(() => { settled = true; });
    const filtered = media.list({ actor: staleAdmin, ownerUserId: 2 });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    const results = await Promise.allSettled([writer, reading, filtered]);
    expect(results[0].status).toBe('fulfilled');
    expect(results[2].status).toBe('rejected');
    if (state === 'disabled') expect(results[1].status).toBe('rejected');
    else {
      expect(results[1].status).toBe('fulfilled');
      const result = (results[1] as PromiseFulfilledResult<Awaited<ReturnType<MediaService['list']>>>).value;
      expect(result.total).toBe(2);
      expect(result.items.map(item => item.originalName).sort()).toEqual(['Alice private', 'Public']);
    }
  });
  it.each(['disabled', 'viewer', 'transferred', 'rollback'])('rechecks queued media edits after another writer: %s', async state => {
    const item = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Alice private' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      if (state === 'viewer') await manager.update(User, 1, { role: 'viewer' });
      else if (state === 'transferred') await manager.update(MediaAsset, item.id, { ownerUserId: 2 });
      else await manager.update(User, 1, { enabled: false });
      entered(); await held;
      if (state === 'rollback') throw new Error('synthetic rollback');
    });
    await ready;
    let settled = false;
    const edit = media.updateOwned(item.id, alice, { remark: 'queued edit' }).finally(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    const results = await Promise.allSettled([writer, edit]);
    expect(results.map(result => result.status)).toEqual(state === 'rollback' ? ['rejected', 'fulfilled'] : ['fulfilled', 'rejected']);
    expect((await media.get(item.id)).remark).toBe(state === 'rollback' ? 'queued edit' : null);
  });
  it('filters before pagination and count, not after returning all data', async () => {
    const a = await media.list({ actor: alice, limit: 1 });
    expect(a.total).toBe(2);
    expect(a.items).toHaveLength(1);
    const b = await media.list({ actor: bob });
    expect(b.items.map(x => x.originalName).sort()).toEqual(['Bob private', 'Public']);
    expect((await media.list({ actor: admin })).total).toBe(3);
  });
  it('scopes personal/shared collections and restricts owner filters to administrators', async () => {
    expect((await media.list({ actor: alice, scope: 'mine' })).items.map(x => x.originalName)).toEqual(['Alice private']);
    expect((await media.list({ actor: alice, scope: 'shared' })).total).toBe(1);
    const result = await media.list({ actor: admin, ownerUserId: 2, limit: 1 });
    expect(result.total).toBe(1);
    expect(result.items[0].originalName).toBe('Bob private');
    await expect(media.list({ actor: alice, ownerUserId: 2 })).rejects.toThrow();
    await expect(media.list({ actor: admin, ownerUserId: NaN })).rejects.toThrow();
    await expect(media.list({ actor: alice, limit: NaN })).rejects.toThrow();
    await expect(media.list({ actor: alice, scope: 'invalid' as any })).rejects.toThrow();
  });
  it('searches within the permission boundary and paginates in stable ID order', async () => {
    expect((await media.list({ actor: alice, keyword: 'Bob' })).total).toBe(0);
    expect((await media.list({ actor: admin, keyword: 'bob' })).items[0].originalName).toBe('Bob private');
    expect((await media.list({ actor: alice, keyword: '%' })).total).toBe(0);
    const first = await media.list({ actor: admin, limit: 1, offset: 0 });
    const second = await media.list({ actor: admin, limit: 1, offset: 1 });
    expect(first.total).toBe(3);
    expect(first.items[0].id).not.toBe(second.items[0].id);
    await expect(media.list({ actor: alice, keyword: 'x'.repeat(201) })).rejects.toThrow();
  });
  it('rejects revoked import owners and non-admin orphan ingestion before touching files', async () => {
    await db.getRepository(User).update(1, { enabled: false });
    await expect(media.ingestFromBuffer('test.mp3', 'audio/mpeg', Buffer.from('test'), alice.username, alice)).rejects.toThrow('导入账户已停用');
    await expect(media.ingestFromFile('test.mp3', 'audio/mpeg', '/nonexistent-import-test', alice.username, alice)).rejects.toThrow('导入账户已停用');
    await db.getRepository(User).update(1, { enabled: true, role: 'viewer' });
    await expect(media.ingestFromFile('test.mp3', 'audio/mpeg', '/nonexistent-import-test', alice.username, alice)).rejects.toThrow('上传权限');
    await expect(media.importOrphan('test.mp3', bob.username, bob)).rejects.toThrow('仅管理员');
    expect(await db.getRepository(MediaAsset).count()).toBe(3);
  });
  it('atomically limits ownership transfers including outstanding upload reservations', async () => {
    const first = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Alice private' });
    const second = await media.createWebpage('Another private', 'https://example.test/another', alice);
    await db.getRepository(MediaAsset).update(first.id, { sizeBytes: 80 });
    await db.getRepository(MediaAsset).update(second.id, { sizeBytes: 80 });
    await db.getRepository(User).update(2, { storageQuotaBytes: 100 });
    await db.query("INSERT INTO upload_reservations (id, owner_user_id, bytes) VALUES ('test-reservation', 2, 30)");
    await expect(media.updateOwned(first.id, admin, { ownerUserId: 2, originalName: 'must not change' })).rejects.toThrow('配额不足');
    expect((await media.get(first.id)).originalName).toBe('Alice private');
    await db.query("DELETE FROM upload_reservations WHERE id = 'test-reservation'");
    const results = await Promise.allSettled([media.updateOwned(first.id, admin, { ownerUserId: 2 }), media.updateOwned(second.id, admin, { ownerUserId: 2 })]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(x => x.status === 'rejected')).toHaveLength(1);
  });
  it.each(['ready', 'failed'])('retains ownership for %s media while a recovery reservation exists', async processingStatus => {
    const item = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Alice private' });
    await db.getRepository(MediaAsset).update(item.id, { processingStatus: processingStatus as 'ready' | 'failed' });
    await db.query('INSERT INTO upload_reservations (id, owner_user_id, bytes, target_media_id) VALUES (?, ?, ?, ?)', ['retained', 1, 40, item.id]);
    await expect(media.updateOwned(item.id, admin, { ownerUserId: 2, originalName: 'not-committed' })).rejects.toThrow('待恢复预留');
    expect(await media.get(item.id)).toMatchObject({ ownerUserId: 1, originalName: 'Alice private' });
    expect(await db.query('SELECT owner_user_id, bytes FROM upload_reservations WHERE id = ?', ['retained'])).toEqual([{ owner_user_id: 1, bytes: 40 }]);
    await media.updateOwned(item.id, admin, { remark: 'can still annotate' });
    await db.query('DELETE FROM upload_reservations WHERE id = ?', ['retained']);
    expect((await media.updateOwned(item.id, admin, { ownerUserId: 2 })).ownerUserId).toBe(2);
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

  it('exposes source classification and prevents administrators editing system assets', async () => {
    const item = await db.getRepository(MediaAsset).findOneByOrFail({ originalName: 'Public' });
    await db.getRepository(MediaAsset).update(item.id, { source: 'system' });
    const listed = (await media.list({ actor: admin })).items.find((row) => row.id === item.id);
    expect(listed?.source).toBe('system');
    await expect(media.authorized(item.id, admin, true)).rejects.toThrow('版本发布统一管理');
    await expect(media.updateOwned(item.id, admin, { originalName: 'renamed' })).rejects.toThrow('版本发布统一管理');
    expect((await media.get(item.id)).originalName).toBe('Public');
  });
});
