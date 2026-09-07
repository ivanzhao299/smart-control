import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaService } from './media.service';
import { Actor } from '../../common/auth/actor';
import { MediaQuotaService } from './media-quota.service';
import { AddUploadReservations1788618003000 } from '../../migrations/1788618003000-AddUploadReservations';
import { BindUploadTemporaryFiles1788618004000 } from '../../migrations/1788618004000-BindUploadTemporaryFiles';
import { TrackUploadInstances1788618005000 } from '../../migrations/1788618005000-TrackUploadInstances';
import { LinkUploadMedia1788618006000 } from '../../migrations/1788618006000-LinkUploadMedia';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

describe('file ingestion compensation', () => {
  let db: DataSource, root: string, media: MediaService;
  const actor: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  beforeEach(async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [User, MediaAsset], synchronize: true }).initialize();
    await db.getRepository(User).save({ id: 1, username: 'alice', password: 'test', role: 'operator' });
    root = await fs.mkdtemp(join(tmpdir(), 'smart-control-ingest-test-'));
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    Object.defineProperty(media, 'mediaRoot', { value: root });
  });
  afterEach(async () => { jest.restoreAllMocks(); await db.destroy(); await fs.rm(root, { recursive: true, force: true }); });
  it('restores the hand-copied orphan source when final database commit fails', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    await db.query("CREATE TRIGGER fail_orphan_path BEFORE UPDATE OF path ON media_assets BEGIN SELECT RAISE(ABORT, 'synthetic commit failure'); END");
    await expect(media.importOrphan('manual.mp3', admin.username, admin)).rejects.toThrow('synthetic commit failure');
    expect(await fs.readFile(join(root, 'manual.mp3'), 'utf8')).toBe('manual');
    expect(await fs.readdir(root)).toEqual(['manual.mp3']);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    media.acquireOperation(1)();
  });
  it('retains both files and accounting if the original orphan path is occupied during recovery', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    const source = join(root, 'manual.mp3');
    await fs.writeFile(source, 'manual');
    await db.query("CREATE TRIGGER fail_orphan_path BEFORE UPDATE OF path ON media_assets BEGIN SELECT RAISE(ABORT, 'synthetic commit failure'); END");
    const rename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      await rename(from, to);
      await fs.writeFile(source, 'new unrelated file', { flag: 'wx' });
    });
    await expect(media.importOrphan('manual.mp3', admin.username, admin)).rejects.toThrow('自动恢复未完成');
    expect(await fs.readFile(source, 'utf8')).toBe('new unrelated file');
    expect(await fs.readFile(join(root, '1', 'manual.mp3'), 'utf8')).toBe('manual');
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
    media.acquireOperation(1)();
  });
  it('cleans only the empty allocation when moving an orphan fails', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    jest.spyOn(fs, 'rename').mockRejectedValueOnce(new Error('synthetic move failure'));
    await expect(media.importOrphan('manual.mp3', admin.username, admin)).rejects.toThrow('synthetic move failure');
    expect(await fs.readFile(join(root, 'manual.mp3'), 'utf8')).toBe('manual');
    expect(await fs.readdir(root)).toEqual(['manual.mp3']);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('orphan finalization preserves concurrent metadata and returns the committed asset', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    await db.query("CREATE TRIGGER edit_orphan BEFORE UPDATE OF path ON media_assets BEGIN UPDATE media_assets SET owner_user_id = 1, visibility = 'shared', originalName = 'edited.mp3' WHERE id = NEW.id; END");
    const item = await media.importOrphan('manual.mp3', admin.username, admin);
    expect(item).toMatchObject({ ownerUserId: 1, visibility: 'shared', originalName: 'edited.mp3' });
    expect(await fs.readFile(item.path, 'utf8')).toBe('manual');
    media.acquireOperation(item.id)();
  });
  it('orphan allocation collision preserves both the original file and existing ID directory', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.mkdir(join(root, '1'));
    await fs.writeFile(join(root, '1', 'manual.mp3'), 'existing');
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    await expect(media.importOrphan('manual.mp3', admin.username, admin)).rejects.toThrow();
    expect(await fs.readFile(join(root, 'manual.mp3'), 'utf8')).toBe('manual');
    expect(await fs.readFile(join(root, '1', 'manual.mp3'), 'utf8')).toBe('existing');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    media.acquireOperation(1)();
  });
  it('rechecks orphan administrator permission at initial allocation after filesystem inspection', async () => {
    await db.getRepository(User).update(1, { role: 'admin' });
    const source = join(root, 'manual.mp3');
    await fs.writeFile(source, 'preserve');
    const stat = fs.stat.bind(fs);
    jest.spyOn(fs, 'stat').mockImplementationOnce(async (...args: any[]) => {
      const result = await (stat as any)(...args);
      await serializedTransaction(db, manager => manager.update(User, 1, { role: 'operator' }));
      return result;
    });
    await expect(media.importOrphan('manual.mp3', 'alice', { ...actor, role: 'admin' })).rejects.toThrow('不再是管理员');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await fs.readFile(source, 'utf8')).toBe('preserve');
    expect(await fs.readdir(root)).toEqual(['manual.mp3']);
  });
  it.each(['disabled', 'demoted'])('rejects a revoked named administrator before orphan filesystem access: %s', async state => {
    await db.getRepository(User).update(1, { role: 'admin' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held;
      await manager.update(User, 1, state === 'disabled' ? { enabled: false } : { role: 'operator' });
    });
    await ready;
    const realpath = jest.spyOn(fs, 'realpath');
    const imported = media.importOrphan('absent.mp3', 'alice', { ...actor, role: 'admin' });
    await new Promise(resolve => setImmediate(resolve));
    expect(realpath).not.toHaveBeenCalled();
    finish();
    expect((await Promise.allSettled([writer, imported])).map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(realpath).not.toHaveBeenCalled();
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('does not scan or import managed originals, derivatives, pending uploads or quarantine files', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    const paths = ['1/source.mp4', '2/playback-converting.mp4', '_tmp/inflight.mp3', '.delete-3-test/files/original.mp3'];
    for (const file of paths) {
      await fs.mkdir(join(root, file, '..'), { recursive: true });
      await fs.writeFile(join(root, file), 'preserve');
    }
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    expect((await media.scanOrphans()).map(item => item.relPath)).toEqual(['manual.mp3']);
    for (const file of paths) {
      await expect(media.importOrphan(file, admin.username, admin)).rejects.toThrow('不能收编');
      expect(await fs.readFile(join(root, file), 'utf8')).toBe('preserve');
    }
    await fs.symlink(join(root, '1'), join(root, 'alias'), 'dir');
    await expect(media.importOrphan('alias/source.mp4', admin.username, admin)).rejects.toThrow('不能收编');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('video preparation waits for rollback before reading source paths or writing processing state', async () => {
    const item = await db.getRepository(MediaAsset).save({ originalName: 'original.mp4', safeName: 'original.mp4', path: '/test/committed.mp4', kind: 'video', mimeType: 'video/mp4', sizeBytes: 10, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      await manager.update(MediaAsset, item.id, { path: '/test/uncommitted.mp4' });
      entered(); await held; throw new Error('synthetic rollback');
    });
    await ready;
    const probe = jest.spyOn(media as any, 'probeVideo').mockResolvedValue({ videoCodec: 'h264', audioCodec: 'aac', duration: 10 });
    const preparation = media.prepareVideo(item.id);
    await new Promise(resolve => setImmediate(resolve));
    expect(probe).not.toHaveBeenCalled();
    finish();
    expect((await Promise.allSettled([writer, preparation])).map(result => result.status)).toEqual(['rejected', 'fulfilled']);
    expect(probe).toHaveBeenCalledWith('/test/committed.mp4');
    expect(await media.get(item.id)).toMatchObject({ path: '/test/committed.mp4', processingStatus: 'ready', durationSec: 10 });
    media.acquireOperation(item.id)();
  });
  it.each(['commit-revocation', 'rollback'])('coordinates webpage creation with another writer: %s', async outcome => {
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      await manager.update(User, 1, { enabled: false });
      entered(); await held;
      if (outcome === 'rollback') throw new Error('synthetic rollback');
    });
    await ready;
    let settled = false;
    const webpage = media.createWebpage('Private site', 'https://example.test/private', actor).finally(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    const results = await Promise.allSettled([writer, webpage]);
    if (outcome === 'commit-revocation') {
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
      expect(await db.getRepository(MediaAsset).count()).toBe(0);
    } else {
      expect(results.map(result => result.status)).toEqual(['rejected', 'fulfilled']);
      expect(await db.getRepository(MediaAsset).find()).toEqual([expect.objectContaining({
        ownerUserId: 1, uploader: 'alice', visibility: 'private', source: 'webpage',
      })]);
    }
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('rechecks import permission after waiting for another coordinated writer', async () => {
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const writer = serializedTransaction(db, async manager => {
      entered(); await held;
      await manager.update(User, 1, { enabled: false });
    });
    await ready;
    let settled = false;
    const imported = media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor).finally(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve));
    expect(settled).toBe(false);
    finish();
    const results = await Promise.allSettled([writer, imported]);
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('holds the asset operation lock across file writing and releases it after finalization', async () => {
    const asset = await db.getRepository(MediaAsset).save({ originalName: 'sample.mp3', safeName: 'sample.mp3', path: '', kind: 'audio', mimeType: 'audio/mpeg', sizeBytes: 6, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    let entered!: () => void, releaseWrite!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { releaseWrite = resolve; });
    const pending = (media as any).finishNewAsset(asset, async (target: string) => {
      entered(); await held; await fs.writeFile(target, 'sample');
    });
    await ready;
    try {
      await expect(media.remove(asset.id, actor)).rejects.toThrow('正在使用');
      expect(() => media.acquireOperation(asset.id)).toThrow('正在使用');
    } finally { releaseWrite(); }
    const result = await pending;
    expect(await fs.readFile(result.path, 'utf8')).toBe('sample');
    media.acquireOperation(asset.id)();
  });
  it.each([true, false])('atomically links the initial asset to its upload reservation (valid binding=%s)', async valid => {
    const runner = db.createQueryRunner();
    for (const migration of [new AddUploadReservations1788618003000(), new BindUploadTemporaryFiles1788618004000(), new TrackUploadInstances1788618005000(), new LinkUploadMedia1788618006000()]) await migration.up(runner);
    const quota = new MediaQuotaService(db);
    const reservation = await quota.reserve(actor, 6);
    const name = '01234567-1234-1234-1234-012345678901.upload';
    await quota.bindTemporary(actor, reservation, name);
    await fs.mkdir(join(root, '_tmp'));
    const path = join(root, '_tmp', name);
    await fs.writeFile(path, 'sample');
    const file = { path, originalname: 'sample.mp3', mimetype: 'audio/mpeg', size: 6 } as Express.Multer.File;
    if (!valid) {
      await expect(media.ingest(file, actor.username, undefined, actor, 'wrong-reservation')).rejects.toThrow('绑定已失效');
      expect(await db.getRepository(MediaAsset).count()).toBe(0);
      expect(await fs.readFile(path, 'utf8')).toBe('sample');
      return;
    }
    const asset = await media.ingest(file, actor.username, undefined, actor, reservation);
    expect((await db.query('SELECT target_media_id FROM upload_reservations WHERE id = ?', [reservation]))[0].target_media_id).toBe(asset.id);
    expect(await fs.readFile(asset.path, 'utf8')).toBe('sample');
    await expect(new LinkUploadMedia1788618006000().down(runner)).rejects.toThrow('MULTIUSER_ROLLBACK_REQUIRES_ARCHIVE');
    await quota.release(actor, reservation);
    await new LinkUploadMedia1788618006000().down(runner);
  });
  it('stores the final path and private owner on successful buffer ingestion', async () => {
    const item = await media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor);
    expect(item.ownerUserId).toBe(1);
    expect(item.visibility).toBe('private');
    expect(await fs.readFile(item.path, 'utf8')).toBe('sample');
  });
  it('removes newly written files and database rows when final save fails', async () => {
    const repo = db.getRepository(MediaAsset);
    await db.query("CREATE TRIGGER fail_final_path BEFORE UPDATE OF path ON media_assets BEGIN SELECT RAISE(ABORT, 'injected final-save failure'); END");
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow('injected');
    expect(await repo.count()).toBe(0);
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('never removes an existing ID directory when allocation collides', async () => {
    await fs.mkdir(join(root, '1'));
    await fs.writeFile(join(root, '1', 'preserve.txt'), 'existing');
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow();
    expect(await fs.readFile(join(root, '1', 'preserve.txt'), 'utf8')).toBe('existing');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('retains accounting records if failed-ingest directory cleanup fails', async () => {
    const repo = db.getRepository(MediaAsset);
    await db.query("CREATE TRIGGER fail_final_path BEFORE UPDATE OF path ON media_assets BEGIN SELECT RAISE(ABORT, 'save failed'); END");
    jest.spyOn(fs, 'rm').mockRejectedValueOnce(new Error('cleanup denied'));
    await expect(media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor)).rejects.toThrow('cleanup denied');
    expect(await repo.count()).toBe(1);
    expect((await repo.find())[0].sizeBytes).toBe(6);
    expect(await fs.readFile(join(root, '1', 'sample.mp3'), 'utf8')).toBe('sample');
  });
  it('finalizing the file path preserves admin edits made after initial insertion', async () => {
    await db.getRepository(User).save({ id: 2, username: 'bob', password: 'test', role: 'operator' });
    await db.query("CREATE TRIGGER edit_metadata BEFORE UPDATE OF path ON media_assets BEGIN UPDATE media_assets SET owner_user_id = 2, visibility = 'shared', originalName = 'admin-renamed.mp3' WHERE id = NEW.id; END");
    const result = await media.ingestFromBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), 'alice', actor);
    expect(result).toMatchObject({ ownerUserId: 2, visibility: 'shared', originalName: 'admin-renamed.mp3' });
    expect(await fs.readFile(result.path, 'utf8')).toBe('sample');
  });
  it('does not restore stale ownership or visibility after asynchronous video probing', async () => {
    await db.getRepository(User).save({ id: 2, username: 'bob', password: 'test', role: 'operator' });
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'original.mp4', safeName: 'original.mp4', path: '/test/original.mp4', kind: 'video', mimeType: 'video/mp4', sizeBytes: 10, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    jest.spyOn(media as any, 'probeVideo').mockImplementation(async () => {
      await repo.update(item.id, { ownerUserId: 2, visibility: 'shared', originalName: 'Administrator renamed.mp4' });
      return { videoCodec: 'h264', audioCodec: 'aac', duration: 10 };
    });
    await media.prepareVideo(item.id);
    expect(await repo.findOneByOrFail({ id: item.id })).toMatchObject({ ownerUserId: 2, visibility: 'shared', originalName: 'Administrator renamed.mp4', processingStatus: 'ready' });
  });
});
