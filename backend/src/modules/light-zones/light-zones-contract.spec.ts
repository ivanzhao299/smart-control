import { ValidationPipe } from '@nestjs/common';
import { CreateLightZoneDto, UpdateLightZoneDto } from './dto/light-zone.dto';
import { AssignGroupsDto, CreateGroupDto, GroupShortsDto, ReorderDto } from './dto/group.dto';
import { DataSource } from 'typeorm';
import { LightZone } from '../../entities/light-zone.entity';
import { LightGroup } from '../../entities/light-group.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { LightZonesService } from './light-zones.service';

describe('light metadata runtime contract', () => {
  const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });
  const body = (metatype: new () => unknown, value: unknown) =>
    pipe.transform(value, { type: 'body', metatype });

  it('rejects unknown fields and invalid zone metadata before service code', async () => {
    await expect(body(CreateLightZoneDto, {
      code: '  foyer  ', name: '前厅', floor: '1F', unknown: 'must reject',
    })).rejects.toThrow();
    await expect(body(CreateLightZoneDto, { code: '', name: '前厅', floor: '1F' })).rejects.toThrow();
    await expect(body(UpdateLightZoneDto, { name: 'x'.repeat(129) })).rejects.toThrow();
  });

  it('accepts only bounded group, reorder, and short-address metadata', async () => {
    await expect(body(CreateGroupDto, { gatewayCode: 'GW-1', daliGroup: 17 })).rejects.toThrow();
    await expect(body(GroupShortsDto, { shorts: [0, 64] })).rejects.toThrow();
    await expect(body(AssignGroupsDto, { groupIds: [] })).rejects.toThrow();
    await expect(body(ReorderDto, { ids: [1, '2'] })).rejects.toThrow();
    await expect(body(CreateGroupDto, { gatewayCode: 'GW-1', daliGroup: 3, zoneCode: null })).resolves.toMatchObject({ daliGroup: 3 });
  });
});

describe('light zone CAS and audit boundary', () => {
  let db: DataSource;
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('advances a revision, records named audits, and rejects stale writes/deletes', async () => {
    db = await new DataSource({
      type: 'better-sqlite3', database: ':memory:', synchronize: true,
      entities: [LightZone, LightGroup, HardwareUnit, AuditLog],
    }).initialize();
    const service = new LightZonesService(
      db.getRepository(LightZone), db.getRepository(LightGroup), db.getRepository(HardwareUnit),
      db.getRepository(AuditLog), { warn: jest.fn() } as any,
    );
    const actor = { kind: 'user', userId: 1, username: 'named-admin', role: 'admin' } as const;
    const created = await service.create({ code: 'lz-cas', name: 'CAS', floor: '1F' }, actor);
    expect(created.configRevision).toBe(1);
    const updated = await service.update(created.id, { name: 'CAS 2', expectedRevision: 1 }, actor);
    expect(updated.configRevision).toBe(2);
    await expect(service.update(created.id, { name: 'stale', expectedRevision: 1 }, actor)).rejects.toMatchObject({
      response: { code: 'LIGHT_ZONE_REVISION_CONFLICT' },
    });
    expect((await service.detail(created.id)).name).toBe('CAS 2');
    expect(await db.getRepository(AuditLog).count()).toBe(2);
    await expect(service.remove(created.id, 1, actor)).rejects.toMatchObject({
      response: { code: 'LIGHT_ZONE_REVISION_CONFLICT' },
    });
    await service.remove(created.id, 2, actor);
    expect(await db.getRepository(AuditLog).count()).toBe(3);
  });

  it('protects group assignment, order, and measured shorts with per-row CAS', async () => {
    db = new DataSource({
      type: 'better-sqlite3', database: ':memory:', synchronize: true,
      entities: [LightZone, LightGroup, HardwareUnit, AuditLog],
    });
    await db.initialize();
    const service = new LightZonesService(
      db.getRepository(LightZone), db.getRepository(LightGroup), db.getRepository(HardwareUnit),
      db.getRepository(AuditLog), { warn: jest.fn() } as any,
    );
    const actor = { kind: 'user', userId: 1, username: 'named-admin', role: 'admin' } as const;
    const first = await service.createGroup({ gatewayCode: 'GW-1', daliGroup: 1 }, actor);
    const second = await service.createGroup({ gatewayCode: 'GW-1', daliGroup: 2 }, actor);
    await service.create({ code: 'zone-a', name: 'Zone A', floor: '1F' }, actor);
    const current = await service.listGroups();
    const assigned = await service.assignGroups([first.id, second.id], 'zone-a', {
      [first.id]: current.find((row) => row.id === first.id)!.configRevision,
      [second.id]: current.find((row) => row.id === second.id)!.configRevision,
    }, actor);
    expect(assigned.count).toBe(2);
    const firstAssigned = (await service.listGroups()).find((row) => row.id === first.id)!;
    const updated = await service.setGroupShorts(first.id, [1, 4], firstAssigned.configRevision, actor);
    expect(updated.configRevision).toBe(firstAssigned.configRevision + 1);
    await expect(service.setGroupShorts(first.id, [2], firstAssigned.configRevision, actor)).rejects.toMatchObject({
      response: { code: 'LIGHT_GROUP_REVISION_CONFLICT' },
    });
    await expect(service.reorderGroups([first.id], { [first.id]: firstAssigned.configRevision }, actor)).rejects.toMatchObject({
      response: { code: 'LIGHT_GROUP_REVISION_CONFLICT' },
    });
    expect(await db.getRepository(AuditLog).count()).toBe(6);
  });
});
