import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { MediaQuotaService } from './media-quota.service';
import { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { BindUploadTemporaryFiles1788618004000 } from '../../migrations/1788618004000-BindUploadTemporaryFiles';
import { TrackUploadInstances1788618005000 } from '../../migrations/1788618005000-TrackUploadInstances';
import { LinkUploadMedia1788618006000 } from '../../migrations/1788618006000-LinkUploadMedia';
import { TrackSystemUploadReservations1788618008000 } from '../../migrations/1788618008000-TrackSystemUploadReservations';

describe('atomic upload capacity reservations', () => {
  let db: DataSource, quota: MediaQuotaService;
  const alice: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  const bob: Actor = { ...alice, userId: 2, username: 'bob' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User, MediaAsset], synchronize: true }).initialize();
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await new BindUploadTemporaryFiles1788618004000().up(db.createQueryRunner());
    await new TrackUploadInstances1788618005000().up(db.createQueryRunner());
    await new LinkUploadMedia1788618006000().up(db.createQueryRunner());
    await new TrackSystemUploadReservations1788618008000().up(db.createQueryRunner());
    await db.getRepository(User).save([{ id: 1, username: 'alice', password: 'test', role: 'operator', storageQuotaBytes: 100 }, { id: 2, username: 'bob', password: 'test', role: 'operator', storageQuotaBytes: 100 }]);
    quota = new MediaQuotaService(db);
  });
  afterEach(async () => { await db.destroy(); });
  it('preserves named reservations and their owner foreign key through the nullable-owner migration', async () => {
    const id = await quota.reserve(alice, 30);
    await quota.bindTemporary(alice, id, '01234567-1234-1234-1234-012345678901.upload');
    const before = await db.query('SELECT * FROM upload_reservations');
    const migration = new TrackSystemUploadReservations1788618008000();
    await migration.down(db.createQueryRunner());
    await migration.up(db.createQueryRunner());
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual(before);
    await expect(db.getRepository(User).delete(1)).rejects.toThrow();
    expect(await db.query('PRAGMA foreign_key_check')).toEqual([]);
  });
  it('persists system uploads, isolates their binding and release, and refuses unsafe rollback', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    const id = await quota.reserve(admin, 60);
    expect(id).toEqual(expect.any(String));
    await expect(quota.bindTemporary(alice, id, '01234567-1234-1234-1234-012345678901.upload')).rejects.toThrow();
    await quota.bindTemporary(admin, id, '01234567-1234-1234-1234-012345678901.upload');
    await quota.release(alice, id);
    expect(await db.query('SELECT owner_user_id, bytes FROM upload_reservations WHERE id = ?', [id])).toEqual([{ owner_user_id: null, bytes: 60 }]);
    const migration = new TrackSystemUploadReservations1788618008000();
    await expect(migration.down(db.createQueryRunner())).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await quota.release(admin, id);
    await migration.down(db.createQueryRunner());
  });
  it('reserves encoder output from remaining capacity and blocks competing uploads or duplicate processing', async () => {
    const media = await db.getRepository(MediaAsset).save({ originalName: 'a.mov', safeName: 'a.mov', path: '/fixture/a.mov', kind: 'video', mimeType: 'video/quicktime', sizeBytes: 40, ownerUserId: 1, visibility: 'private', processingStatus: 'processing' });
    const conversion = await quota.reserveConversion(media.id, 1, 1000);
    expect(conversion.bytes).toBe(60);
    expect((await quota.usage(alice)).reservedBytes).toBe(60);
    await expect(quota.reserve(alice, 1)).rejects.toThrow();
    await expect(quota.reserveConversion(media.id, 1, 20)).rejects.toThrow();
    await quota.releaseConversion(conversion.id, media.id + 1);
    expect((await quota.usage(alice)).reservedBytes).toBe(60);
    await quota.releaseConversion(conversion.id, media.id);
    expect((await quota.usage(alice)).reservedBytes).toBe(0);
  });
  it('rejects a conversion after ownership or account permission changes', async () => {
    const media = await db.getRepository(MediaAsset).save({ originalName: 'a.mov', safeName: 'a.mov', path: '/fixture/a.mov', kind: 'video', mimeType: 'video/quicktime', sizeBytes: 40, ownerUserId: 1, visibility: 'private', processingStatus: 'processing' });
    await expect(quota.reserveConversion(media.id, 2, 20)).rejects.toThrow('归属');
    await db.getRepository(User).update(1, { enabled: false });
    await expect(quota.reserveConversion(media.id, 1, 20)).rejects.toThrow();
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
  });
  it.each(['disabled', 'viewer'])('does not bind or consume a temporary filename after the account becomes %s', async state => {
    const id = await quota.reserve(alice, 10);
    await db.getRepository(User).update(1, state === 'disabled' ? { enabled: false } : { role: 'viewer' });
    await expect(quota.bindTemporary(alice, id, '01234567-1234-1234-1234-012345678901.upload')).rejects.toThrow('无上传权限');
    expect(await db.query('SELECT id FROM upload_instances')).toEqual([]);
    expect(await db.query('SELECT temp_name, instance_id FROM upload_reservations WHERE id = ?', [id])).toEqual([{ temp_name: null, instance_id: null }]);
    // Revocation must not prevent failure cleanup from releasing the reservation.
    await quota.release(alice, id);
    expect((await quota.usage(alice)).reservedBytes).toBe(0);
  });
  it('binds one exact temporary name to its owner and refuses rebinding or destructive rollback', async () => {
    const id = await quota.reserve(alice, 10);
    const name = '01234567-1234-1234-1234-012345678901.upload';
    await expect(quota.bindTemporary(bob, id, name)).rejects.toThrow();
    await expect(quota.bindTemporary(alice, id, '../outside.upload')).rejects.toThrow();
    await quota.bindTemporary(alice, id, name);
    const [row] = await db.query('SELECT temp_name, instance_id FROM upload_reservations WHERE id = ?', [id]);
    expect(row.temp_name).toBe(name);
    expect(row.instance_id).toMatch(/^[0-9a-f-]{36}$/);
    const [instance] = await db.query('SELECT id, pid, started_at FROM upload_instances');
    expect(instance.id).toBe(row.instance_id);
    expect(instance.pid).toBe(process.pid);
    expect(Number.isFinite(Date.parse(instance.started_at))).toBe(true);
    await expect(new TrackUploadInstances1788618005000().down(db.createQueryRunner())).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await expect(quota.bindTemporary(alice, id, name)).rejects.toThrow('已绑定');
    const migration = new BindUploadTemporaryFiles1788618004000();
    await expect(migration.down(db.createQueryRunner())).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await quota.release(alice, id);
    await new TrackUploadInstances1788618005000().down(db.createQueryRunner());
    await migration.down(db.createQueryRunner());
  });
  it('waits for a coordinated transaction instead of exposing its uncommitted quota', async () => {
    let started!: () => void, release!: () => void;
    const ready = new Promise<void>(resolve => { started = resolve; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const writer = serializedTransaction(db, async manager => {
      await manager.query('UPDATE users SET storage_quota_bytes = 999 WHERE id = 1');
      started(); await held;
      throw new Error('rollback temporary quota');
    });
    await ready;
    let completed = false;
    const reader = quota.usage(alice).then(value => { completed = true; return value; });
    // Drain async microtasks while the writer deliberately remains open.
    await new Promise(resolve => setImmediate(resolve));
    expect(completed).toBe(false);
    release();
    const [writeResult, readResult] = await Promise.allSettled([writer, reader]);
    expect(writeResult.status).toBe('rejected');
    expect(readResult).toEqual({ status: 'fulfilled', value: { quotaBytes: 100, usedBytes: 0, reservedBytes: 0 } });
  });
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
