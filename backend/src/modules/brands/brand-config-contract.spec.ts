import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { AuditLog } from '../../entities/audit-log.entity';
import { Brand } from '../../entities/brand.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { User } from '../../entities/user.entity';
import { BrandsService } from './brands.service';
import { BrandsController } from './brands.controller';
import {
  CreateBrandConfigDto,
  UpdateBrandConfigDto,
  BrandRevisionQueryDto,
  safeBrandUrl,
} from './brand-config.dto';

describe('brand configuration contract (synthetic SQLite only)', () => {
  let db: DataSource, service: BrandsService, actor: Actor;
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const serviceFor = () =>
    new BrandsService(
      db.getRepository(Brand),
      db.getRepository(HardwareUnit),
      db.getRepository(DriverTemplate),
    );
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [Brand, HardwareUnit, DriverTemplate, AuditLog, User],
    }).initialize();
    const user = await db.getRepository(User).save({
      username: 'named-maintainer',
      password: 'synthetic-not-a-password',
      role: 'admin',
      enabled: true,
    });
    actor = { kind: 'user', userId: user.id, username: user.username, role: 'admin' };
    service = serviceFor();
  });
  afterEach(async () => {
    await db.destroy();
  });

  it('preserves exact keys, nullable fields and false, normalizes optional text, and suppresses no-op revisions/audits', async () => {
    const first = await service.create(
      {
        name: ' Exact Key ',
        displayName: ' Friendly ',
        logoUrl: null,
        country: '',
        enabled: false,
      },
      actor,
    );
    expect(first).toMatchObject({
      name: ' Exact Key ',
      displayName: 'Friendly',
      logoUrl: null,
      country: null,
      enabled: false,
      configRevision: 1,
    });
    const same = await service.update(
      first.id,
      { displayName: ' Friendly ', country: '', expectedRevision: 1 },
      actor,
    );
    expect(same).toEqual(first);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
    const updated = await service.update(
      first.id,
      { displayName: null, expectedRevision: 1 },
      actor,
    );
    expect(updated).toMatchObject({ displayName: null, configRevision: 2 });
    const events = await db.getRepository(AuditLog).find({ order: { id: 'ASC' } });
    expect(events.map((e) => e.operator)).toEqual(['named-maintainer', 'named-maintainer']);
    expect(JSON.parse(events[1].snapshotBefore!)).toMatchObject({
      configRevision: 1,
      displayName: 'Friendly',
    });
    expect(JSON.parse(events[1].snapshotAfter!)).toMatchObject({
      configRevision: 2,
      displayName: null,
    });
  });

  it('CAS admits one of two independent service writers and rejects stale update/delete even for unchanged fields', async () => {
    const row = await service.create({ name: 'Race' }, actor);
    const writes = await Promise.allSettled([
      service.update(row.id, { displayName: 'First', expectedRevision: 1 }, actor),
      serviceFor().update(row.id, { displayName: 'Second', expectedRevision: 1 }, actor),
    ]);
    expect(writes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(writes.filter((r) => r.status === 'rejected')).toMatchObject([
      { reason: { status: 409, response: { code: 'BRAND_CONFIG_REVISION_CONFLICT' } } },
    ]);
    const current = await service.detail(row.id);
    await expect(
      service.update(row.id, { displayName: current.displayName, expectedRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 409 });
    await expect(service.remove(row.id, 1, actor)).rejects.toMatchObject({ status: 409 });
    await service.remove(row.id, 2, actor);
    await expect(service.remove(row.id, 2, actor)).rejects.toMatchObject({ status: 404 });
    await expect(service.remove(row.id, undefined, actor)).resolves.toBeUndefined();
    expect(await db.getRepository(AuditLog).count()).toBe(3);
  });

  it('maps duplicate exact keys to a stable conflict and rolls back the failed rename', async () => {
    const a = await service.create({ name: 'A' }, actor);
    await service.create({ name: 'B' }, actor);
    await expect(service.create({ name: 'A' }, actor)).rejects.toMatchObject({
      status: 409,
      response: { code: 'BRAND_CONFIG_KEY_CONFLICT' },
    });
    await expect(
      service.update(a.id, { name: 'B', expectedRevision: 1 }, actor),
    ).rejects.toMatchObject({ status: 409 });
    expect(await service.detail(a.id)).toMatchObject({ name: 'A', configRevision: 1 });
    expect(await db.getRepository(AuditLog).count()).toBe(2);
  });

  it('rolls back create/update/delete and automatic catalog establishment when audit insertion fails', async () => {
    const row = await service.create({ name: 'Kept' }, actor);
    await db.query(
      "CREATE TRIGGER reject_brand_audit BEFORE INSERT ON audit_logs WHEN NEW.entityType='brand' BEGIN SELECT RAISE(ABORT,'synthetic audit failure'); END",
    );
    await expect(service.create({ name: 'Never created' }, actor)).rejects.toThrow(
      'synthetic audit failure',
    );
    await expect(
      service.update(row.id, { displayName: 'Never saved', expectedRevision: 1 }, actor),
    ).rejects.toThrow('synthetic audit failure');
    await expect(service.remove(row.id, 1, actor)).rejects.toThrow('synthetic audit failure');
    const referenced = jest.fn();
    await expect(service.withReference('Never referenced', referenced)).rejects.toThrow(
      'synthetic audit failure',
    );
    expect(referenced).not.toHaveBeenCalled();
    expect(await service.detail(row.id)).toEqual(row);
    expect(await db.getRepository(Brand).count()).toBe(1);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
  });

  it('redacts signed URL query and fragment from both audit snapshots, not the stored URL', async () => {
    const url = 'https://assets.invalid/logo.png?token=synthetic-secret#private';
    const row = await service.create(
      { name: 'Signed', logoUrl: url, website: 'https://brand.invalid/?key=hidden' },
      actor,
    );
    expect(row.logoUrl).toBe(url);
    await service.update(row.id, { remark: 'new', expectedRevision: 1 }, actor);
    const events = JSON.stringify(await db.getRepository(AuditLog).find());
    expect(events).not.toMatch(/synthetic-secret|private|hidden/);
    expect(events).toContain('https://assets.invalid/logo.png');
  });

  it('rechecks a named administrator inside the transaction after queued demotion', async () => {
    const demote = serializedTransaction(db, async (manager) => {
      await manager.update(User, actor.userId!, { role: 'viewer' });
    });
    const save = service.create({ name: 'Denied' }, actor);
    await demote;
    await expect(save).rejects.toMatchObject({ status: 403 });
    expect(await db.getRepository(Brand).count()).toBe(0);
  });

  it('requires an authenticated administrator at each write controller entry', async () => {
    const controller = new BrandsController(service);
    for (const req of [{}, { actor: { ...actor, role: 'operator' } }]) {
      const status = 'actor' in req ? 403 : 401;
      await expect(controller.create({ name: 'Denied' }, req as never)).rejects.toMatchObject({
        status,
      });
      await expect(
        controller.updateEditor(1, { expectedRevision: 1 }, req as never),
      ).rejects.toMatchObject({ status });
      await expect(
        controller.removeEditor(1, { expectedRevision: 1 }, req as never),
      ).rejects.toMatchObject({ status });
      await expect(controller.update(1, {}, req as never)).rejects.toMatchObject({ status });
      await expect(controller.remove(1, {}, req as never)).rejects.toMatchObject({ status });
    }
  });

  it.each([
    { name: null },
    { name: '' },
    { name: ' ' },
    { name: 1 },
    { name: 'n'.repeat(129) },
    { enabled: null },
    { enabled: 'false' },
    { configRevision: 4 },
    { operator: 'forged' },
    { expectedRevision: null },
    { expectedRevision: 0 },
    { expectedRevision: 1.5 },
    { expectedRevision: '1' },
  ])('rejects malformed/forged fields %j at the service boundary', async (patch) => {
    const row = await service.create({ name: 'Untouched' }, actor);
    await expect(service.update(row.id, patch as never, actor)).rejects.toMatchObject({
      status: 400,
    });
    expect(await service.detail(row.id)).toEqual(row);
  });

  it('requires a revision in modern DTOs while allowing the explicit legacy bridge', async () => {
    await expect(
      pipe.transform(
        { displayName: 'missing revision' },
        { type: 'body', metatype: UpdateBrandConfigDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      pipe.transform({}, { type: 'query', metatype: BrandRevisionQueryDto }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await pipe.transform(
        { expectedRevision: '2' },
        { type: 'query', metatype: BrandRevisionQueryDto },
      ),
    ).toMatchObject({ expectedRevision: 2 });
    await expect(
      pipe.transform(
        { name: 'Valid', invented: 1 },
        { type: 'body', metatype: CreateBrandConfigDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
    const row = await service.create({ name: 'Legacy' }, actor);
    expect(await service.update(row.id, { displayName: 'Legacy edit' }, actor)).toMatchObject({
      configRevision: 2,
    });
  });

  it.each([
    'javascript:alert(1)',
    'data:image/svg+xml,active',
    '//evil.invalid/logo',
    'https://user:password@brand.invalid/logo',
    'https://brand.invalid/with space',
    '/media/../admin',
    '/media/%2e%2e/admin',
    '\\evil.invalid\\x',
  ])('rejects unsafe logo URLs: %s', async (logoUrl) => {
    expect(safeBrandUrl(logoUrl, true)).toBe(false);
    await expect(service.create({ name: 'Unsafe', logoUrl }, actor)).rejects.toMatchObject({
      status: 400,
    });
  });
});
