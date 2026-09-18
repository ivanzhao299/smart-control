import { ValidationPipe } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { HvacZone } from '../../entities/hvac-zone.entity';
import { HvacIndoor } from '../../entities/hvac-indoor.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { HvacController } from './hvac.controller';
import { HvacIndoorUpdateDto, HvacZoneRenameDto } from './dto/hvac.dto';

describe('HVAC metadata CAS and audit boundary', () => {
  let db: DataSource;
  const actor = { kind: 'user', userId: 1, username: 'named-admin', role: 'admin' } as const;
  const req = { actor } as any;

  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('requires revisions for existing metadata and rejects stale writes atomically', async () => {
    const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
    await expect(pipe.transform({ name: 'new' }, { type: 'body', metatype: HvacZoneRenameDto })).rejects.toThrow();
    await expect(pipe.transform({ zoneCode: 'zone-a' }, { type: 'body', metatype: HvacIndoorUpdateDto })).rejects.toThrow();

    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:', synchronize: true,
      entities: [HvacZone, HvacIndoor, AuditLog],
    }).initialize();
    const log = { record: jest.fn().mockResolvedValue(undefined) } as any;
    const controller = new HvacController(
      {} as any, {} as any, log,
      db.getRepository(HvacZone), db.getRepository(HvacIndoor),
    );
    const created = await controller.createZone({ name: '会议室', floor: '1F' }, req);
    expect(created.data.configRevision).toBe(1);
    const renamed = await controller.renameZone(created.data.code, { name: '会议室 A', expectedRevision: 1 }, req);
    expect(renamed.data.configRevision).toBe(2);
    await expect(controller.renameZone(created.data.code, { name: '过期', expectedRevision: 1 }, req)).rejects.toMatchObject({
      response: { code: 'HVAC_ZONE_REVISION_CONFLICT' },
    });
    const indoor = await db.getRepository(HvacIndoor).save(db.getRepository(HvacIndoor).create({
      idx: 1, configRevision: 1, name: '1F-01', floor: '1F', zoneCode: created.data.code,
      model: null, sortOrder: 10, enabled: true,
    }));
    const updated = await controller.updateIndoor(indoor.idx, { name: '前厅', expectedRevision: 1 }, req);
    expect(updated.data.configRevision).toBe(2);
    await expect(controller.updateIndoor(indoor.idx, { name: '过期', expectedRevision: 1 }, req)).rejects.toMatchObject({
      response: { code: 'HVAC_INDOOR_REVISION_CONFLICT' },
    });
    expect(await db.getRepository(AuditLog).count()).toBe(3);
  });
});
