import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MediaService } from './media.service';
import { MediaAsset } from '../../entities/media-asset.entity';
import { User } from '../../entities/user.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { PlaybackHistory } from '../../entities/playback-history.entity';
import { Actor } from '../../common/auth/actor';
import { SystemBranding } from '../../entities/system-branding.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { writeSystemBranding } from '../system-branding/system-branding-config.writer';

describe('transactional media/reference deletion', () => {
  let db: DataSource, root: string, service: MediaService, id: number;
  const actor: Actor = { kind: 'user', userId: 1, username: 'alice', role: 'operator' };
  beforeEach(async () => {
    root = await fs.mkdtemp(join(tmpdir(), 'sc-delete-db-'));
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', entities: [MediaAsset, User, PlaylistItem, PlaybackChannel, PlaybackHistory, SystemBranding, AuditLog], synchronize: true }).initialize();
    await db.getRepository(User).save({ id: 1, username: 'alice', password: 'test', role: 'operator' });
    service = new MediaService(db.getRepository(MediaAsset), new ConfigService({ media: { root } }), { warn() {} } as any);
    Object.defineProperty(service, 'mediaRoot', { value: root });
    const media = await service.createWebpage('private', 'https://example.test', actor);
    id = media.id;
    await fs.mkdir(join(root, String(id)));
    await fs.writeFile(join(root, String(id), 'data.txt'), 'original');
    await db.getRepository(PlaylistItem).save({ slot: 1, mediaId: id, ownerUserId: 1, title: 'personal' });
    await db.getRepository(PlaybackHistory).save({ slot: 1, mediaId: id, ownerUserId: 1, mediaName: 'private snapshot' });
  });
  afterEach(async () => { await db.destroy(); await fs.rm(root, { recursive: true, force: true }); });
  it('deletes references and asset together while retaining owned historical snapshots', async () => {
    await service.remove(id, actor);
    expect(await db.getRepository(MediaAsset).count()).toBe(0);
    expect(await db.getRepository(PlaylistItem).count()).toBe(0);
    expect(await db.getRepository(PlaybackHistory).findOneByOrFail({ mediaId: id })).toMatchObject({ ownerUserId: 1, mediaName: 'private snapshot' });
    expect(await fs.readdir(root)).toEqual([]);
  });
  it('rolls back playlist removal and restores files when the database rejects media deletion', async () => {
    await db.query("CREATE TRIGGER reject_test_delete BEFORE DELETE ON media_assets BEGIN SELECT RAISE(ABORT, 'injected deletion failure'); END");
    await expect(service.remove(id, actor)).rejects.toThrow('injected deletion failure');
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
    expect(await db.getRepository(PlaylistItem).count()).toBe(1);
    expect(await db.getRepository(PlaybackHistory).count()).toBe(1);
    expect(await fs.readFile(join(root, String(id), 'data.txt'), 'utf8')).toBe('original');
    expect(await fs.readdir(root)).toEqual([String(id)]);
  });
  it('deletes a welcome photo from its dedicated managed directory', async () => {
    const photo = await db.getRepository(MediaAsset).save({
      originalName: 'welcome-led.jpg', safeName: 'welcome-led.jpg', path: '', kind: 'image',
      mimeType: 'image/jpeg', sizeBytes: 5, ownerUserId: 1, visibility: 'private',
      source: 'upload', remark: 'welcome-photo', uploader: 'alice', processingStatus: 'ready',
    });
    const directory = join(root, 'welcome-photos', String(photo.id));
    const path = join(directory, 'welcome-led.jpg');
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(path, 'photo');
    await db.getRepository(MediaAsset).update(photo.id, { path });

    await service.remove(photo.id, actor);

    await expect(fs.access(directory)).rejects.toThrow();
    expect(await fs.readdir(join(root, 'welcome-photos'))).toEqual([]);
  });
  it.each(['welcomeMediaId', 'welcomeBgMediaId', 'welcomePhotoMediaId'])('preserves files and references while bound as %s', async field => {
    await db.getRepository(SystemBranding).save({ id: 1, systemName: 'fixture', logoText: 'T', [field]: id });
    await expect(service.remove(id, actor)).rejects.toMatchObject({ status: 409, response: { code: 'MEDIA_BOUND_TO_WELCOME' } });
    expect(await fs.readFile(join(root, String(id), 'data.txt'), 'utf8')).toBe('original');
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
    expect(await db.getRepository(PlaylistItem).count()).toBe(1);
  });
  it('rechecks a binding established after the initial deletion check and restores staged files', async () => {
    await db.getRepository(SystemBranding).save({ id: 1, systemName: 'fixture', logoText: 'T' });
    const repo = db.getRepository(MediaAsset), query = repo.query.bind(repo);
    jest.spyOn(repo, 'query').mockImplementation(async (sql, params) => {
      const result = await query(sql, params);
      if (sql.includes('FROM system_branding_v2')) {
        await writeSystemBranding(db.getRepository(SystemBranding), { welcomeMediaId: id, expectedRevision: 1 },
          { kind: 'admin', userId: null, username: 'race-admin', role: 'admin' });
      }
      return result;
    });
    await expect(service.remove(id, actor)).rejects.toMatchObject({ status: 409, response: { code: 'MEDIA_BOUND_TO_WELCOME' } });
    expect(await fs.readFile(join(root, String(id), 'data.txt'), 'utf8')).toBe('original');
    expect(await fs.readdir(root)).toEqual([String(id)]);
    expect((await db.getRepository(SystemBranding).findOneByOrFail({ id: 1 })).welcomeMediaId).toBe(id);
    expect(await db.getRepository(MediaAsset).count()).toBe(1);
  });
  it('refuses a binding to an asset already deleted by the serialized writer', async () => {
    await db.getRepository(SystemBranding).save({ id: 1, systemName: 'fixture', logoText: 'T' });
    await service.remove(id, actor);
    await expect(writeSystemBranding(db.getRepository(SystemBranding), { welcomeMediaId: id, expectedRevision: 1 },
      { kind: 'admin', userId: null, username: 'race-admin', role: 'admin' })).rejects.toMatchObject({ status: 400, response: { code: 'SYSTEM_BRANDING_MEDIA_INVALID' } });
    expect((await db.getRepository(SystemBranding).findOneByOrFail({ id: 1 })).configRevision).toBe(1);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
});
