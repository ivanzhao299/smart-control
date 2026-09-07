import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { MediaQuotaService } from './media-quota.service';
import { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

describe('atomic upload capacity reservations', () => {
  let db: DataSource, quota: MediaQuotaService;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User, MediaAsset], synchronize: true }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test', role: 'operator', storageQuotaBytes: 100 }, { id: 2, username: 'bob', password: 'test', role: 'operator', storageQuotaBytes: 100 }]);
    quota = new MediaQuotaService(db);
  });
  afterEach(async () => { await db.destroy(); });
  it('does not enlist a concurrent reservation in another service transaction rollback', async () => {
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const other = serializedTransaction(db, async manager => {
      await manager.query('UPDATE users SET storage_quota_bytes = 0 WHERE id = 1');
      started(); await held;
      throw new Error('other service rollback');
    });
    await ready;
    let settled = false;
    const pending = quota.reserve(alice, 60).finally(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    release();
    const results = await Promise.allSettled([other, pending]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(await quota.usage(alice)).toEqual({ quotaBytes: 100, usedBytes: 0, reservedBytes: 60 });
  });
  it('allows only one of two concurrent reservations exceeding remaining space', async () => {
    const results = await Promise.allSettled([quota.reserve(alice, 60), quota.reserve(alice, 60)]);
    expect(results.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(await quota.usage(alice)).toEqual({ quotaBytes: 100, usedBytes: 0, reservedBytes: 60 });
    expect((await quota.usage(bob)).reservedBytes).toBe(0);
  });
  it('does not let another user release capacity; release is idempotent', async () => {
    const id = await quota.reserve(alice, 100);
    await quota.release(bob, id);
    await expect(quota.reserve(alice, 1)).rejects.toThrow();
    await quota.release(alice, id);
    await quota.release(alice, id);
    expect((await quota.usage(alice)).reservedBytes).toBe(0);
  });
  it('counts already stored files together with reservations', async () => {
    await db.getRepository(MediaAsset).save({ originalName: 'stored.mp3', safeName: 'stored.mp3', path: '/fixture/stored.mp3', kind: 'audio', mimeType: 'audio/mpeg', sizeBytes: 80, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    await expect(quota.reserve(alice, 21)).rejects.toThrow();
    await quota.reserve(alice, 20);
    expect(await quota.usage(alice)).toEqual({ quotaBytes: 100, usedBytes: 80, reservedBytes: 20 });
  });
  it('checks current enabled/role and refuses invalid byte counts', async () => {
    await db.getRepository(User).update(1, { enabled: false });
    await expect(quota.reserve(alice, 1)).rejects.toThrow();
    await db.getRepository(User).update(1, { enabled: true, role: 'viewer' });
    await expect(quota.reserve(alice, 1)).rejects.toThrow();
    for (const n of [-1, NaN, Infinity, 1.2]) await expect(quota.reserve(bob, n)).rejects.toThrow();
  });
  it('refuses migration rollback with active reservations', async () => {
    const migration = new AddUploadReservations1788618003000();
    const id = await quota.reserve(alice, 10);
    await expect(migration.down(db.createQueryRunner())).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await quota.release(alice, id);
    await migration.down(db.createQueryRunner());
    expect(await db.createQueryRunner().hasTable('upload_reservations')).toBe(false);
  });
  it('restricts quota edits to administrators and refuses lowering below reservations', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await quota.reserve(alice, 60);
    await expect(quota.setLimit(bob, 1, 500)).rejects.toThrow('仅管理员');
    await expect(quota.setLimit(admin, 1, 59)).rejects.toThrow('低于');
    expect((await quota.usage(alice)).quotaBytes).toBe(100);
    await quota.setLimit(admin, 1, 60);
    expect((await quota.usage(alice)).quotaBytes).toBe(60);
    await expect(quota.reserve(alice, 1)).rejects.toThrow();
  });
});
