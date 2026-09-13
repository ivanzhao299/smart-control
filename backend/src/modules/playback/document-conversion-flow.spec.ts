import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { MediaService } from '../media/media.service';
import { MediaQuotaService } from '../media/media-quota.service';
import { PlayerDeviceAccessService } from './player-device-access.service';

describe('document device reservation through completed media accounting', () => {
  let db: DataSource, root: string, service: PlayerDeviceAccessService, media: MediaService, quota: MediaQuotaService, item: MediaAsset;
  beforeEach(async () => {
    root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'sc-document-flow-')));
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: false,
      entities: [resolve(__dirname, '../../entities/*.entity.ts')], migrations: [resolve(__dirname, '../../migrations/*.ts')],
    }).initialize();
    await db.runMigrations();
    await db.getRepository(User).save({ id: 1, username: 'owner', password: 'fixture', role: 'operator', storageQuotaBytes: 24 });
    await fs.writeFile(join(root, 'brief.docx'), 'original');
    item = await db.getRepository(MediaAsset).save({ originalName: 'brief.docx', safeName: 'brief.docx', path: join(root, 'brief.docx'), kind: 'doc', mimeType: 'application/msword', sizeBytes: 8, ownerUserId: 1, visibility: 'private', processingStatus: 'ready' });
    await db.getRepository(PlaybackChannel).save({ slot: 1, name: 'Fixture LED', outputKind: 'led', currentMediaId: item.id, initiatorUserId: 1, playbackSession: 'document-session' });
    media = new MediaService(db.getRepository(MediaAsset), new ConfigService(), {} as any);
    Object.defineProperty(media, 'mediaRoot', { value: root });
    quota = new MediaQuotaService(db);
    jest.spyOn(quota as any, 'availableDiskBytes').mockResolvedValue(10000);
    service = new PlayerDeviceAccessService(db.getRepository(PlaybackChannel), db.getRepository(User), { authenticate: () => ({}) } as any, {} as any, media, quota);
  });
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); await fs.rm(root, { recursive: true, force: true }); });
  it.each(['success', 'oversize', 'session-changed'])('handles the complete service flow: %s', async scenario => {
    const grant = await service.prepareDocument(1, 'synthetic-device', 'document-session');
    expect(grant.maxBytes).toBe(16);
    expect((await media.get(item.id)).processingStatus).toBe('processing');
    await expect(service.prepareDocument(1, 'synthetic-device', 'document-session')).rejects.toThrow();
    await fs.writeFile(grant.pdfPath, scenario === 'oversize' ? '%PDF-' + 'x'.repeat(30) : '%PDF-fixture');
    if (scenario === 'session-changed') await db.getRepository(PlaybackChannel).update({ slot: 1 }, { playbackSession: 'new-session' });
    const result = service.docMeta(1, 'synthetic-device', 'document-session', 2, true, grant.reservationId!);
    if (scenario === 'success') {
      expect(await result).toEqual({ id: item.id, pageCount: 2 });
      expect(await media.get(item.id)).toMatchObject({ processingStatus: 'ready', ownerUserId: 1, sizeBytes: 20, docPdfPath: 'brief.pdf' });
      expect(await db.query('SELECT id FROM upload_reservations')).toEqual([]);
    } else {
      await expect(result).rejects.toThrow();
      expect(await media.get(item.id)).toMatchObject({ processingStatus: 'processing', sizeBytes: 8, docPdfPath: null });
      expect(await db.query('SELECT bytes FROM upload_reservations')).toEqual([{ bytes: 16 }]);
    }
    expect(await fs.readFile(grant.absPath, 'utf8')).toBe('original');
  });
});
