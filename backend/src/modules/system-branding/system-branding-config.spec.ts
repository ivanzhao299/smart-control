import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Actor } from '../../common/auth/actor';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { AuditLog } from '../../entities/audit-log.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { SystemBranding } from '../../entities/system-branding.entity';
import { User } from '../../entities/user.entity';
import { SystemBrandingService } from './system-branding.service';
import { SystemBrandingController } from './system-branding.controller';
import {
  UpdateSystemBrandingDto,
  UpdateWelcomeDto,
  inlineLogo,
} from './system-branding-config.dto';

describe('system branding/welcome configuration (isolated SQLite)', () => {
  let db: DataSource, service: SystemBrandingService, actor: Actor;
  const serviceFor = () =>
    new SystemBrandingService(
      db.getRepository(SystemBranding),
      { info: jest.fn() } as never,
      new ConfigService(),
      {} as RuntimeConfigStore,
    );
  const save = (patch: unknown, welcome = false, strict = true) =>
    service.update(patch, actor, welcome, strict);
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [SystemBranding, AuditLog, MediaAsset, User],
    }).initialize();
    const user = await db.getRepository(User).save({
      username: 'branding-admin',
      password: 'non-login-fixture',
      role: 'admin',
      enabled: true,
    });
    actor = { kind: 'user', userId: user.id, username: user.username, role: 'admin' };
    await db.getRepository(SystemBranding).save({
      id: 1,
      systemName: 'Original',
      logoText: '金',
      welcomeGuest: 'Existing guest',
      parkOpsConfigJson: 'archived-layout-not-in-audit',
    });
    service = serviceFor();
  });
  afterEach(async () => {
    await db.destroy();
  });
  const asset = (
    kind: MediaAsset['kind'] = 'image',
    processingStatus: MediaAsset['processingStatus'] = 'ready',
  ) =>
    db.getRepository(MediaAsset).save({
      originalName: 'synthetic',
      safeName: 'synthetic',
      path: '/synthetic-only',
      kind,
      processingStatus,
      mimeType: 'image/png',
      sizeBytes: 10,
    });

  it('normalizes optional text and null, preserves omitted fields, suppresses no-ops but rejects stale no-ops', async () => {
    const first = await save({ systemName: ' New ', systemSubtitle: '', expectedRevision: 1 });
    expect(first).toMatchObject({
      systemName: 'New',
      systemSubtitle: null,
      welcomeGuest: 'Existing guest',
      configRevision: 2,
    });
    expect(await save({ systemName: 'New', expectedRevision: 2 })).toEqual(first);
    await expect(save({ systemName: 'New', expectedRevision: 1 })).rejects.toMatchObject({
      status: 409,
      response: { code: 'SYSTEM_BRANDING_REVISION_CONFLICT' },
    });
    expect(await db.getRepository(AuditLog).count()).toBe(1);
    expect(await save({ welcomeGuest: null, expectedRevision: 2 }, true)).toMatchObject({
      welcomeGuest: null,
      configRevision: 3,
    });
  });
  it('only one same-version writer succeeds across independent service instances', async () => {
    const results = await Promise.allSettled([
      save({ welcomeTitle: 'First', expectedRevision: 1 }, true),
      serviceFor().update({ systemName: 'Second', expectedRevision: 1 }, actor, false, true),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({ reason: { status: 409 } });
    expect((await service.get()).configRevision).toBe(2);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
  });
  it('rolls back all fields and revision if the atomic audit fails', async () => {
    const before = await db.getRepository(SystemBranding).findOneByOrFail({ id: 1 });
    await db.query(
      "CREATE TRIGGER reject_branding_audit BEFORE INSERT ON audit_logs BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
    );
    await expect(
      save({ systemName: 'Must rollback', welcomeGuest: null, expectedRevision: 1 }),
    ).rejects.toThrow('synthetic audit failure');
    expect(await db.getRepository(SystemBranding).findOneByOrFail({ id: 1 })).toEqual(before);
  });
  it('does not store logo data, signed URL, file path or archived layout in audit snapshots', async () => {
    const signed = 'https://assets.invalid/logo.png?privateToken=fixture#private';
    await save({ logoUrl: signed, expectedRevision: 1 });
    const png = `data:image/png;base64,${Buffer.from('89504e470d0a1a0a010203', 'hex').toString('base64')}`;
    await save({ logoUrl: png, expectedRevision: 2 });
    const events = await db.getRepository(AuditLog).find({ order: { id: 'ASC' } });
    const json = JSON.stringify(events);
    expect(json).not.toMatch(
      /privateToken|assets.invalid|data:image|base64|archived-layout|synthetic-only/,
    );
    expect(JSON.parse(events[1].snapshotAfter!)).toMatchObject({
      logoSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      configRevision: 3,
    });
    expect(events.every((e) => e.operator === actor.username)).toBe(true);
    expect((await service.get()).logoUrl).toBe(png);
  });
  it('requires ready media, image kinds for photos/backgrounds and supports null clearing', async () => {
    const image = await asset(),
      video = await asset('video'),
      pending = await asset('image', 'pending');
    for (const id of [999, video.id, pending.id])
      await expect(
        save({ welcomePhotoMediaId: id, expectedRevision: 1 }, true),
      ).rejects.toMatchObject({ status: 400, response: { code: 'SYSTEM_BRANDING_MEDIA_INVALID' } });
    expect(
      await save({
        welcomeBgMediaId: image.id,
        welcomePhotoMediaId: image.id,
        welcomeMediaId: video.id,
        expectedRevision: 1,
      }),
    ).toMatchObject({
      configRevision: 2,
      welcomeBgUrl: '/api/system-branding/welcome-background/file?v=2',
      welcomePhotoUrl: '/api/system-branding/welcome-photo/file?v=2',
    });
    expect(await service.getWelcomeBackgroundMediaId()).toBe(image.id);
    expect(
      await save({ welcomePhotoMediaId: null, welcomeBgMediaId: null, expectedRevision: 2 }, true),
    ).toMatchObject({
      welcomeBgUrl: null,
      welcomePhotoUrl: null,
      welcomeMediaId: video.id,
      configRevision: 3,
    });
  });
  it('checks demotion or disablement within the queued transaction', async () => {
    const demote = serializedTransaction(db, async (manager) => {
      await manager.update(User, actor.userId!, { enabled: false });
    });
    const writing = save({ systemName: 'Denied', expectedRevision: 1 });
    await demote;
    await expect(writing).rejects.toMatchObject({ status: 403 });
    expect((await service.get()).systemName).toBe('Original');
  });
  it('requires admin authentication on all four controller write entries', async () => {
    const controller = new SystemBrandingController(service, {} as never);
    for (const request of [{}, { actor: { ...actor, role: 'operator' } }]) {
      for (const method of [
        'update',
        'updateEditor',
        'updateWelcome',
        'updateWelcomeEditor',
      ] as const) {
        await expect(
          controller[method]({ welcomeTitle: 'Denied', expectedRevision: 1 }, request as never),
        ).rejects.toMatchObject({ status: 'actor' in request ? 403 : 401 });
      }
    }
  });

  it('never exposes a non-image or unfinished historical binding through public image routes', async () => {
    await db
      .getRepository(SystemBranding)
      .update(1, { welcomeBgMediaId: 12, welcomePhotoMediaId: 12 });
    const openStream = jest.fn();
    for (const media of [
      { kind: 'video', processingStatus: 'ready' },
      { kind: 'image', processingStatus: 'pending' },
    ]) {
      const controller = new SystemBrandingController(service, {
        get: jest.fn().mockResolvedValue(media),
        openStream,
      } as never);
      await expect(
        controller.welcomeBackgroundFile({ headers: {} } as never, {} as never),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        controller.welcomePhotoFile({ headers: {} } as never, {} as never),
      ).rejects.toMatchObject({ status: 404 });
    }
    expect(openStream).not.toHaveBeenCalled();
  });
  it.each([
    { systemName: null },
    { systemName: false },
    { systemName: ' ' },
    { systemName: 'n'.repeat(81) },
    { welcomeGuest: 12 },
    { welcomeTitle: 'x'.repeat(33) },
    { welcomeTagline: 'x'.repeat(65) },
    { welcomePhotoMediaId: 0 },
    { welcomePhotoMediaId: '1' },
    { welcomePhotoMediaId: 1.2 },
    { expectedRevision: null },
    { expectedRevision: '1' },
    { expectedRevision: 0 },
    { operator: 'forged' },
    { configRevision: 99 },
    { welcomePhotoUrl: '/forged' },
    { logoUrl: 'javascript:alert(1)' },
    { logoUrl: '//unsafe.invalid/logo' },
    { logoUrl: 'https://u:secret@unsafe.invalid/logo' },
    { logoUrl: 'data:image/svg+xml;base64,PHN2Zz4=' },
    { logoUrl: 'data:image/png;base64,PHNjcmlwdD4=' },
    { logoUrl: `data:image/png;base64,${'A'.repeat(700001)}` },
  ])('rejects invalid/forged payload case %# before writing', async (patch) => {
    await expect(
      save({ welcomeTitle: 'Keep', expectedRevision: 1, ...patch }),
    ).rejects.toMatchObject({ status: 400 });
    expect((await service.get()).configRevision).toBe(1);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
  });
  it('enforces strict/welcome-only DTOs and explicit legacy compatibility without silent truncation', async () => {
    const pipe = new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    });
    for (const metatype of [UpdateWelcomeDto, UpdateSystemBrandingDto])
      await expect(
        pipe.transform({ welcomeGuest: 'Missing revision' }, { type: 'body', metatype }),
      ).rejects.toMatchObject({ status: 400 });
    await expect(
      save({ systemName: 'Forbidden in welcome', expectedRevision: 1 }, true),
    ).rejects.toMatchObject({ status: 400 });
    await expect(save({ expectedRevision: 1 })).rejects.toMatchObject({ status: 400 });
    expect(await save({ welcomeGuest: 'Legacy patch' }, true, false)).toMatchObject({
      configRevision: 2,
    });
  });
  it('rejects invalid persisted versions and does not overflow safe integers', async () => {
    for (const configRevision of [0, Number.MAX_SAFE_INTEGER]) {
      await db.getRepository(SystemBranding).update(1, { configRevision });
      await expect(save({ welcomeTitle: 'No overflow' }, true, false)).rejects.toMatchObject({
        status: 409,
        response: { code: 'SYSTEM_BRANDING_REVISION_INVALID' },
      });
    }
  });
  it('hashes complete logo bytes and refuses serving unsafe historical SVG/redirect URLs', async () => {
    const controller = new SystemBrandingController(service, {} as never);
    const response = () => ({
      req: { headers: {} },
      redirect: jest.fn(),
      status: jest.fn().mockReturnThis(),
      end: jest.fn(),
      setHeader: jest.fn(),
      send: jest.fn(),
    });
    const etags: string[] = [];
    for (const tail of ['01', '02']) {
      const url = `data:image/png;base64,${Buffer.from(`89504e470d0a1a0a${tail}`, 'hex').toString('base64')}`;
      expect(inlineLogo(url)?.mime).toBe('image/png');
      await db.getRepository(SystemBranding).update(1, { logoUrl: url });
      const res = response();
      await controller.logo(res as never);
      etags.push(res.setHeader.mock.calls.find((c) => c[0] === 'ETag')![1]);
      expect(res.setHeader).toHaveBeenCalledWith('X-Content-Type-Options', 'nosniff');
    }
    expect(etags[0]).not.toBe(etags[1]);
    for (const logoUrl of ['javascript:alert(1)', 'data:image/svg+xml;base64,PHN2Zz4=']) {
      await db.getRepository(SystemBranding).update(1, { logoUrl });
      const res = response();
      await controller.logo(res as never);
      expect(res.redirect).toHaveBeenCalledWith(302, '/control/icons/pwa-512x512.png');
      expect(res.send).not.toHaveBeenCalled();
    }
  });
});
