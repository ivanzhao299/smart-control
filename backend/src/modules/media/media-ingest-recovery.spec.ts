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
import { TrackSystemUploadReservations1788618008000 } from '../../migrations/1788618008000-TrackSystemUploadReservations';
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
  it('does not commit document metadata when the final transaction authorization rejects', async () => {
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'a.docx', safeName: 'a.docx', path: '/fixture/a.docx', kind: 'doc', mimeType: 'application/msword', sizeBytes: 8, ownerUserId: 1, visibility: 'private', pageCount: 2 });
    const authorize = jest.fn(async (manager, current) => {
      expect(manager.queryRunner.isTransactionActive).toBe(true);
      expect(current.id).toBe(item.id);
      throw new Error('session changed');
    });
    await expect(media.setDocMeta(item.id, { pageCount: 9 }, authorize)).rejects.toThrow('session changed');
    expect(authorize).toHaveBeenCalledTimes(1);
    await expect(media.setDocMeta(item.id, { pageCount: 9 }, { ...actor, role: 'admin' })).rejects.toThrow('管理员权限已失效');
    expect((await repo.findOneByOrFail({ id: item.id })).pageCount).toBe(2);
    await db.getRepository(User).update(1, { role: 'admin' });
    expect((await media.setDocMeta(item.id, { pageCount: 9 }, { ...actor, role: 'admin' })).pageCount).toBe(9);
  });
  it('validates a document PDF and accounts original plus derivative without replacing metadata', async () => {
    const original = join(root, 'document.docx'), pdf = join(root, 'document.pdf');
    await fs.writeFile(original, 'original'); await fs.writeFile(pdf, '%PDF-synthetic');
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'document.docx', safeName: 'document.docx', path: original, sourcePath: original, kind: 'doc', mimeType: 'application/msword', sizeBytes: 8, ownerUserId: 1, visibility: 'private', remark: 'keep this' });
    await db.query("CREATE TRIGGER doc_metadata_edit BEFORE UPDATE OF pageCount ON media_assets BEGIN UPDATE media_assets SET originalName = 'admin-renamed.docx' WHERE id = NEW.id; END");
    const updated = await media.setDocMeta(item.id, { pageCount: 4, pdfRelPath: 'document.pdf' });
    expect(updated).toMatchObject({ ownerUserId: 1, visibility: 'private', remark: 'keep this', originalName: 'admin-renamed.docx', pageCount: 4, docPdfPath: 'document.pdf', sizeBytes: 8 + Buffer.byteLength('%PDF-synthetic') });
  });
  it('rejects invalid pages and foreign or non-PDF derivatives without changing a document', async () => {
    const original = join(root, 'document.docx');
    await fs.writeFile(original, 'original'); await fs.writeFile(join(root, 'other.pdf'), '%PDF-other');
    await fs.writeFile(join(root, 'document.pdf'), 'not-pdf');
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'document.docx', safeName: 'document.docx', path: original, kind: 'doc', mimeType: 'application/msword', sizeBytes: 8, ownerUserId: 1, visibility: 'private', pageCount: 2 });
    for (const pageCount of [0, -1, 1.5, NaN, 100001]) await expect(media.setDocMeta(item.id, { pageCount })).rejects.toThrow();
    await expect(media.setDocMeta(item.id, { pageCount: 5, pdfRelPath: 'other.pdf' })).rejects.toThrow('不匹配');
    await expect(media.setDocMeta(item.id, { pageCount: 5, pdfRelPath: 'document.pdf' })).rejects.toThrow('不是PDF');
    expect(await repo.findOneByOrFail({ id: item.id })).toMatchObject({ pageCount: 2, docPdfPath: null, sizeBytes: 8 });
  });
  it('does not resurrect a document deleted while metadata was waiting for a transaction', async () => {
    const item = await db.getRepository(MediaAsset).save({ originalName: 'a.docx', safeName: 'a.docx', path: '/fixture/a.docx', kind: 'doc', mimeType: 'application/msword', sizeBytes: 8, ownerUserId: 1, visibility: 'private' });
    let entered!: () => void, finish!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const held = new Promise<void>(resolve => { finish = resolve; });
    const deleting = serializedTransaction(db, async manager => { entered(); await held; await manager.delete(MediaAsset, item.id); });
    await ready;
    const updating = media.setDocMeta(item.id, { pageCount: 4 });
    finish();
    expect((await Promise.allSettled([deleting, updating])).map(result => result.status)).toEqual(['fulfilled', 'rejected']);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it.each([true, false])('does not treat a same-name private asset as a bundled system asset (file exists=%s)', async exists => {
    await conversionSchema();
    const name = '左右声道测试.wav';
    const privatePath = join(root, 'private.wav');
    if (exists) await fs.writeFile(privatePath, 'private-original');
    const repo = db.getRepository(MediaAsset);
    const privateAsset = await repo.save({ originalName: name, safeName: 'private.wav', path: privatePath, kind: 'audio', mimeType: 'audio/wav', sizeBytes: 16, ownerUserId: 1, visibility: 'private', source: 'upload' });
    const bundled = join(root, 'bundled.wav');
    await fs.writeFile(bundled, 'system-content');
    (media as any).logger = { info: jest.fn(), warn: jest.fn() };
    await (media as any).seedBundledFile({ file: bundled, originalName: name, kind: 'audio', mime: 'audio/wav', remark: 'fixture' });
    const rows = await repo.find({ where: { originalName: name } });
    expect(rows).toHaveLength(2);
    expect(await repo.findOneByOrFail({ id: privateAsset.id })).toEqual(privateAsset);
    const system = rows.find(row => row.source === 'system')!;
    expect(system).toMatchObject({ ownerUserId: null, visibility: 'shared' });
    expect(await fs.readFile(system.path, 'utf8')).toBe('system-content');
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    if (exists) expect(await fs.readFile(privatePath, 'utf8')).toBe('private-original');
    else await expect(fs.access(privatePath)).rejects.toThrow();
  });
  async function conversionSchema() {
    for (const migration of [new AddUploadReservations1788618003000(), new BindUploadTemporaryFiles1788618004000(), new TrackUploadInstances1788618005000(), new LinkUploadMedia1788618006000()]) await migration.up(db.createQueryRunner());
    await new TrackSystemUploadReservations1788618008000().up(db.createQueryRunner());
  }
  it.each(['metadata', 'owner'])('rechecks bundled repair before commit and preserves concurrent %s edits', async change => {
    await conversionSchema();
    const repo = db.getRepository(MediaAsset);
    const originalName = 'system.wav';
    const existing = await repo.save({ originalName, safeName: 'system.wav', path: '', kind: 'audio', mimeType: 'audio/wav', sizeBytes: 14, ownerUserId: null, source: 'system', visibility: 'shared', remark: 'original remark' });
    const source = join(root, 'bundled.wav');
    await fs.writeFile(source, 'system-content');
    (media as any).logger = { info: jest.fn(), warn: jest.fn() };
    const open = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => {
      await repo.update(existing.id, change === 'owner' ? { ownerUserId: 1, visibility: 'private' } : { remark: 'admin edit', visibility: 'private' });
      return open(file, flags, mode);
    });
    const operation = (media as any).seedBundledFile({ file: source, originalName, kind: 'audio', mime: 'audio/wav', remark: 'fixture' });
    if (change === 'owner') {
      await expect(operation).rejects.toThrow('归属');
      expect(await repo.findOneByOrFail({ id: existing.id })).toMatchObject({ ownerUserId: 1, visibility: 'private', path: '' });
      expect(await fs.readdir(join(root, String(existing.id)))).toEqual([]);
    } else {
      await operation;
      const result = await repo.findOneByOrFail({ id: existing.id });
      expect(result).toMatchObject({ ownerUserId: null, visibility: 'private', remark: 'admin edit', sizeBytes: 14 });
      expect(await fs.readFile(result.path, 'utf8')).toBe('system-content');
    }
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    media.acquireOperation(existing.id)();
  });
  it('keeps a linked repair budget when failed-file cleanup cannot finish', async () => {
    await conversionSchema();
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'system.wav', safeName: 'system.wav', path: '', kind: 'audio', mimeType: 'audio/wav', sizeBytes: 14, ownerUserId: null, source: 'system', visibility: 'shared' });
    const source = join(root, 'bundled.wav');
    await fs.writeFile(source, 'system-content');
    const open = fs.open.bind(fs);
    jest.spyOn(fs, 'open').mockImplementationOnce(async (file, flags, mode) => { await repo.update(item.id, { ownerUserId: 1 }); return open(file, flags, mode); });
    jest.spyOn(fs, 'unlink').mockRejectedValueOnce(new Error('cleanup denied'));
    await expect((media as any).seedBundledFile({ file: source, originalName: 'system.wav', kind: 'audio', mime: 'audio/wav', remark: 'fixture' })).rejects.toThrow('cleanup denied');
    expect(await db.query('SELECT target_media_id, bytes FROM upload_reservations')).toEqual([{ target_media_id: item.id, bytes: 14 }]);
    expect(await fs.readdir(join(root, String(item.id)))).toHaveLength(1);
    media.acquireOperation(item.id)();
  });
  it('refuses new bundled copies before writing when no disk budget is available', async () => {
    await conversionSchema();
    const bundled = join(root, 'bundled.wav');
    await fs.writeFile(bundled, 'system-content');
    jest.spyOn(MediaQuotaService.prototype as any, 'availableDiskBytes').mockResolvedValue(0);
    await expect((media as any).seedBundledFile({ file: bundled, originalName: 'system.wav', kind: 'audio', mime: 'audio/wav', remark: 'fixture' })).rejects.toThrow('磁盘');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    expect(await fs.readdir(root)).toEqual(['bundled.wav']);
  });
  it('does not let a named user label reserved uploads as shared system assets', async () => {
    await conversionSchema();
    const quota = new MediaQuotaService(db);
    const reservation = (await quota.reserve(actor, 10, root))!;
    await expect(media.ingestReservedBuffer('a.mp3', 'audio/mpeg', Buffer.from('sample'), actor, reservation, undefined, 'system')).rejects.toThrow('系统身份');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
  });
  it('does not let a private same-name webpage replace the system welcome page', async () => {
    const originalName = '金湖欢迎页·动态(称谓可编辑)';
    const privatePage = await media.createWebpage(originalName, 'https://example.test/private-welcome', actor);
    jest.spyOn(media as any, 'seedBundledFile').mockResolvedValue(undefined);
    (media as any).logger = { info: jest.fn(), warn: jest.fn() };
    await (media as any).seedBundledAssets();
    const rows = await db.getRepository(MediaAsset).find({ where: { originalName } });
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.id === privatePage.id)).toMatchObject({ ownerUserId: 1, visibility: 'private', sourceUrl: 'https://example.test/private-welcome' });
    expect(rows.find(row => row.source === 'system')).toMatchObject({ ownerUserId: null, visibility: 'shared', sourceUrl: 'http://localhost:5173/control/welcome/index.html' });
  });
  it('binds reserved buffers at their actual size, preserves Chinese names and releases after finalization', async () => {
    await conversionSchema();
    const quota = new MediaQuotaService(db);
    const reservation = await quota.reserve(actor, 100, root);
    const result = await media.ingestReservedBuffer('中文曲目.mp3', 'audio/mpeg', Buffer.from('sample'), actor, reservation!);
    expect(result).toMatchObject({ originalName: '中文曲目.mp3', ownerUserId: 1, source: 'import', sizeBytes: 6 });
    expect(await fs.readFile(result.path, 'utf8')).toBe('sample');
    expect(await fs.readdir(join(root, '_tmp'))).toEqual([]);
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
  });
  it('does not release the linked buffer reservation if temporary cleanup reports failure', async () => {
    await conversionSchema();
    const quota = new MediaQuotaService(db);
    const reservation = await quota.reserve(actor, 100, root);
    jest.spyOn(fs, 'unlink').mockRejectedValueOnce(Object.assign(new Error('cleanup denied'), { code: 'EACCES' }));
    await expect(media.ingestReservedBuffer('sample.mp3', 'audio/mpeg', Buffer.from('sample'), actor, reservation!)).rejects.toThrow('cleanup denied');
    const asset = await db.getRepository(MediaAsset).findOneByOrFail({ ownerUserId: 1 });
    expect(await fs.readFile(asset.path, 'utf8')).toBe('sample');
    expect(await db.query('SELECT bytes, target_media_id FROM upload_reservations WHERE id = ?', [reservation])).toEqual([{ bytes: 6, target_media_id: asset.id }]);
  });
  it('removes only this failed conversion temporary file and preserves original and prior playback bytes', async () => {
    await conversionSchema();
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: 'original.mov', safeName: 'original.mov', path: '', kind: 'video', mimeType: 'video/mp4', sizeBytes: 17, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    const directory = join(root, String(item.id));
    await fs.mkdir(directory);
    const source = join(directory, 'original.mov'), previous = join(directory, 'playback.mp4');
    await fs.writeFile(source, 'original'); await fs.writeFile(previous, 'converted');
    await repo.update(item.id, { path: previous, sourcePath: source });
    (media as any).logger = { info: jest.fn(), error: jest.fn() };
    jest.spyOn(media as any, 'probeVideo').mockResolvedValue({ videoCodec: 'hevc' });
    jest.spyOn(media as any, 'runTranscode').mockImplementation(async (...commandArgs: unknown[]) => {
      await fs.writeFile(commandArgs[2] as string, 'incomplete');
      throw new Error('synthetic encoder failure');
    });
    await media.prepareVideo(item.id);
    expect(await repo.findOneByOrFail({ id: item.id })).toMatchObject({ processingStatus: 'failed', path: previous, sourcePath: source, sizeBytes: 17 });
    expect((await fs.readdir(directory)).sort()).toEqual(['original.mov', 'playback.mp4']);
    expect(await fs.readFile(source, 'utf8')).toBe('original');
    expect(await fs.readFile(previous, 'utf8')).toBe('converted');
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    media.acquireOperation(item.id)();
  });
  it.each(['original.mov', 'playback.mp4', 'playback-converting.mp4'])('counts retained video bytes and preserves the original named %s', async name => {
    await conversionSchema();
    const repo = db.getRepository(MediaAsset);
    const item = await repo.save({ originalName: name, safeName: name, path: '', kind: 'video', mimeType: 'video/quicktime', sizeBytes: 8, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    const directory = join(root, String(item.id));
    await fs.mkdir(directory);
    const source = join(directory, name);
    await fs.writeFile(source, 'original');
    const thumb = join(directory, 'thumb.png');
    await fs.writeFile(thumb, 'thumbnail');
    await repo.update(item.id, { path: source, thumbPath: thumb });
    (media as any).logger = { info: jest.fn(), error: jest.fn() };
    jest.spyOn(media as any, 'probeVideo').mockResolvedValue({ videoCodec: 'hevc', audioCodec: 'aac' });
    jest.spyOn(media as any, 'runTranscode').mockImplementation(async (...commandArgs: unknown[]) => {
      const target = commandArgs[2] as string;
      expect(target).not.toBe(source);
      await fs.writeFile(target, 'converted');
      return '';
    });
    await media.prepareVideo(item.id);
    const result = await repo.findOneByOrFail({ id: item.id });
    expect(result).toMatchObject({ processingStatus: 'ready', sourcePath: source, sizeBytes: 26 });
    expect(result.path).not.toBe(source);
    expect(await fs.readFile(source, 'utf8')).toBe('original');
    expect(await fs.readFile(result.path, 'utf8')).toBe('converted');
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
  });
  it('rejects hard-link aliases of managed or unregistered files without moving any link', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.mkdir(join(root, '1'));
    await fs.writeFile(join(root, '1', 'private.mp3'), 'private');
    await fs.link(join(root, '1', 'private.mp3'), join(root, 'alias.mp3'));
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    await fs.link(join(root, 'manual.mp3'), join(root, 'manual-copy.mp3'));
    expect(await media.scanOrphans()).toEqual([]);
    for (const file of ['alias.mp3', 'manual.mp3', 'manual-copy.mp3']) {
      await expect(media.importOrphan(file, admin.username, admin)).rejects.toThrow('硬链接文件不能收编');
    }
    expect(await fs.readFile(join(root, '1', 'private.mp3'), 'utf8')).toBe('private');
    expect(await fs.readFile(join(root, 'alias.mp3'), 'utf8')).toBe('private');
    expect(await fs.readFile(join(root, 'manual.mp3'), 'utf8')).toBe('manual');
    expect(await fs.readFile(join(root, 'manual-copy.mp3'), 'utf8')).toBe('manual');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
  });
  it('excludes legacy registered originals, previews and derivatives from scan and direct orphan import', async () => {
    const admin: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    await fs.mkdir(join(root, 'legacy'));
    for (const name of ['playback.mp4', 'original.mov', 'thumb.png', 'document.pdf']) {
      await fs.writeFile(join(root, 'legacy', name), 'preserve');
    }
    await db.getRepository(MediaAsset).save({ originalName: 'Legacy', safeName: 'playback.mp4',
      path: join(root, 'legacy', 'playback.mp4'), sourcePath: join(root, 'legacy', 'original.mov'),
      thumbPath: 'legacy/thumb.png', docPdfPath: 'legacy/document.pdf', kind: 'video', mimeType: 'video/mp4',
      sizeBytes: 8, ownerUserId: 1, visibility: 'private', uploader: 'alice' });
    await fs.symlink(join(root, 'legacy'), join(root, 'alias'), 'dir');
    expect(await media.scanOrphans()).toEqual([]);
    for (const name of ['playback.mp4', 'original.mov', 'thumb.png', 'document.pdf']) {
      await expect(media.importOrphan('legacy/' + name, admin.username, admin)).rejects.toThrow('不能重复收编');
      await expect(media.importOrphan('alias/' + name, admin.username, admin)).rejects.toThrow('不能重复收编');
      expect(await fs.readFile(join(root, 'legacy', name), 'utf8')).toBe('preserve');
    }
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
  });
  it('restores an orphan that grows after capacity was checked instead of undercounting it', async () => {
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).update(1, { role: 'admin', storageQuotaBytes: 6 });
    const source = join(root, 'manual.mp3');
    await fs.writeFile(source, 'manual');
    const rename = fs.rename.bind(fs);
    jest.spyOn(fs, 'rename').mockImplementationOnce(async (from, to) => {
      await fs.appendFile(source, '-still-copying');
      await rename(from, to);
    });
    await expect(media.importOrphan('manual.mp3', 'alice', { ...actor, role: 'admin' })).rejects.toThrow('文件大小发生变化');
    expect(await fs.readFile(source, 'utf8')).toBe('manual-still-copying');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
  });
  it('atomically accounts concurrent named-admin orphan imports and outstanding reservations', async () => {
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).update(1, { role: 'admin', storageQuotaBytes: 6 });
    const admin: Actor = { ...actor, role: 'admin' };
    await fs.writeFile(join(root, 'one.mp3'), '1234');
    await fs.writeFile(join(root, 'two.mp3'), '5678');
    await db.query("INSERT INTO upload_reservations (id, owner_user_id, bytes) VALUES ('other-upload', 1, 3)");
    await expect(media.importOrphan('one.mp3', admin.username, admin)).rejects.toThrow('配额不足');
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await fs.readFile(join(root, 'one.mp3'), 'utf8')).toBe('1234');
    await db.query("DELETE FROM upload_reservations WHERE id = 'other-upload'");
    const results = await Promise.allSettled(['one.mp3', 'two.mp3'].map(file => media.importOrphan(file, admin.username, admin)));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(result => result.status === 'rejected')).toHaveLength(1);
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    const success = results.find(result => result.status === 'fulfilled') as PromiseFulfilledResult<MediaAsset>;
    expect(success.value.sizeBytes).toBe(4);
    expect((await fs.readFile(success.value.path)).length).toBe(4);
  });
  it('rolls back the temporary quota claim if orphan initial allocation fails', async () => {
    await new AddUploadReservations1788618003000().up(db.createQueryRunner());
    await db.getRepository(User).update(1, { role: 'admin', storageQuotaBytes: 6 });
    await fs.writeFile(join(root, 'manual.mp3'), 'manual');
    await db.query("CREATE TRIGGER fail_orphan_insert BEFORE INSERT ON media_assets BEGIN SELECT RAISE(ABORT, 'synthetic allocation failure'); END");
    await expect(media.importOrphan('manual.mp3', 'alice', { ...actor, role: 'admin' })).rejects.toThrow('synthetic allocation failure');
    expect(await db.query('SELECT * FROM upload_reservations')).toEqual([]);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await fs.readFile(join(root, 'manual.mp3'), 'utf8')).toBe('manual');
  });
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
    const reservation = await quota.reserve(actor, 6, root);
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
