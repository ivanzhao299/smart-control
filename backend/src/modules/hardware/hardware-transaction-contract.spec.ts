import 'reflect-metadata';
import { ConflictException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { Brand } from '../../entities/brand.entity';
import { Device } from '../../entities/device.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { OperationLog } from '../../entities/operation-log.entity';
import { BrandsService } from '../brands/brands.service';
import { OperationLogService } from '../logs/operation-log.service';
import { CreateHardwareDto, UpdateHardwareDto } from './dto/hardware.dto';
import { HardwareService } from './hardware.service';

const logger = { info: jest.fn(), error: jest.fn(), warn: jest.fn() } as any;

const hardware = (overrides: Partial<CreateHardwareDto> = {}): CreateHardwareDto => ({
  code: 'HVAC-GW-1',
  name: 'HVAC gateway',
  category: 'hvac-gateway',
  vendor: 'Fixture Vendor',
  model: 'Fixture Model',
  ip: '10.0.0.10',
  addressing: '{"port":502}',
  ...overrides,
});

describe('HardwareService transaction contract', () => {
  let db: DataSource;
  let service: HardwareService;
  let brands: BrandsService;

  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [HardwareUnit, Device, AuditLog, OperationLog, Brand, DriverTemplate],
      synchronize: true,
    }).initialize();
    brands = new BrandsService(
      db.getRepository(Brand),
      db.getRepository(HardwareUnit),
      db.getRepository(DriverTemplate),
    );
    service = new HardwareService(
      db.getRepository(HardwareUnit),
      db.getRepository(Device),
      new OperationLogService(db.getRepository(OperationLog), logger),
      brands,
      logger,
    );
  });

  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });

  it('uses configRevision as a CAS token and does not increment it for a no-op', async () => {
    const created = await service.create(hardware(), 'fixture-admin');
    const updated = await service.update(created.id, { expectedRevision: 1, name: 'Renamed gateway' }, 'fixture-admin');
    expect(updated.configRevision).toBe(2);

    await expect(service.update(created.id, { expectedRevision: 1, name: 'stale write' }, 'fixture-admin'))
      .rejects.toBeInstanceOf(ConflictException);
    await expect(service.update(created.id, { expectedRevision: 1, name: 'stale write' }, 'fixture-admin'))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'HARDWARE_REVISION_CONFLICT', currentRevision: 2 }) });

    const auditCount = await db.getRepository(AuditLog).count();
    const operationCount = await db.getRepository(OperationLog).count();
    const unchanged = await service.update(created.id, { expectedRevision: 2 }, 'fixture-admin');
    expect(unchanged.configRevision).toBe(2);
    expect(await db.getRepository(AuditLog).count()).toBe(auditCount);
    expect(await db.getRepository(OperationLog).count()).toBe(operationCount);
  });

  it('records each successful create, update, and delete with matching audit and operation entries', async () => {
    const created = await service.create(hardware(), 'verified-admin');
    const updated = await service.update(created.id, { expectedRevision: 1, name: 'Updated gateway' }, 'verified-admin');
    await service.remove(updated.id, updated.configRevision, 'verified-admin');

    const audits = await db.getRepository(AuditLog).find({ order: { id: 'ASC' } });
    const operations = await db.getRepository(OperationLog).find({ order: { id: 'ASC' } });
    expect(audits.map(row => [row.action, row.entityId, row.operator])).toEqual([
      ['create', String(created.id), 'verified-admin'],
      ['update', String(created.id), 'verified-admin'],
      ['delete', String(created.id), 'verified-admin'],
    ]);
    expect(operations.map(row => [row.action, row.targetId, row.operator])).toEqual([
      ['hardware.create', String(created.id), 'verified-admin'],
      ['hardware.update', String(created.id), 'verified-admin'],
      ['hardware.delete', String(created.id), 'verified-admin'],
    ]);
    expect(await db.getRepository(HardwareUnit).count()).toBe(0);
  });

  it.each(['create', 'update', 'delete'] as const)('rolls back %s when its operation log cannot be persisted', async (action) => {
    const existing = await service.create(hardware(), 'fixture-admin');
    const initialAuditCount = await db.getRepository(AuditLog).count();
    const initialOperationCount = await db.getRepository(OperationLog).count();
    await db.query("CREATE TRIGGER fail_hardware_operation_log BEFORE INSERT ON operation_logs WHEN NEW.action LIKE 'hardware.%' BEGIN SELECT RAISE(ABORT, 'operation log unavailable'); END");

    const work = action === 'create'
      ? service.create(hardware({ code: 'HVAC-GW-2', vendor: 'Second Vendor' }), 'fixture-admin')
      : action === 'update'
        ? service.update(existing.id, { expectedRevision: 1, name: 'must rollback' }, 'fixture-admin')
        : service.remove(existing.id, 1, 'fixture-admin');
    await expect(work).rejects.toThrow('operation log unavailable');

    const current = await db.getRepository(HardwareUnit).findOneBy({ id: existing.id });
    if (action === 'create') {
      expect(await db.getRepository(HardwareUnit).count()).toBe(1);
      expect(await db.getRepository(Brand).countBy({ name: 'Second Vendor' })).toBe(0);
    } else if (action === 'update') {
      expect(current).toMatchObject({ name: 'HVAC gateway', configRevision: 1 });
    } else {
      expect(current).toMatchObject({ id: existing.id, configRevision: 1 });
    }
    expect(await db.getRepository(AuditLog).count()).toBe(initialAuditCount);
    expect(await db.getRepository(OperationLog).count()).toBe(initialOperationCount);
  });

  it('rolls back a brand inserted by the transaction when brand reference resolution fails', async () => {
    jest.spyOn(brands, 'ensureReferenced').mockImplementation(async (name, manager) => {
      await manager!.getRepository(Brand).save({ name });
      throw new Error('brand reference unavailable');
    });

    await expect(service.create(hardware({ vendor: 'Unresolved Vendor' }), 'fixture-admin'))
      .rejects.toThrow('brand reference unavailable');
    expect(await db.getRepository(Brand).countBy({ name: 'Unresolved Vendor' })).toBe(0);
    expect(await db.getRepository(HardwareUnit).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(0);
    expect(await db.getRepository(OperationLog).count()).toBe(0);
  });

  it('propagates an HVAC gateway IP with the hardware update, and rolls both back if propagation fails', async () => {
    const gateway = await service.create(hardware(), 'fixture-admin');
    const indoor = await db.getRepository(Device).save({
      name: 'Fixture indoor', category: 'hvac', protocol: 'tcp', adapter: 'mock',
      ip: null, address: '{"gwHost":"10.0.0.10","n":1}', floor: null, zone: null,
      enabled: true, status: 'offline', debugRemark: null, lastTestAt: null, lastTestResult: null,
    });
    const auditCount = await db.getRepository(AuditLog).count();
    const operationCount = await db.getRepository(OperationLog).count();
    await db.query("CREATE TRIGGER fail_hvac_propagation BEFORE UPDATE OF address ON devices BEGIN SELECT RAISE(ABORT, 'hvac propagation unavailable'); END");

    await expect(service.update(gateway.id, { expectedRevision: 1, ip: '10.0.0.11' }, 'fixture-admin'))
      .rejects.toThrow('hvac propagation unavailable');
    expect(await db.getRepository(HardwareUnit).findOneByOrFail({ id: gateway.id }))
      .toMatchObject({ ip: '10.0.0.10', configRevision: 1 });
    expect(await db.getRepository(Device).findOneByOrFail({ id: indoor.id }))
      .toMatchObject({ address: '{"gwHost":"10.0.0.10","n":1}' });
    expect(await db.getRepository(AuditLog).count()).toBe(auditCount);
    expect(await db.getRepository(OperationLog).count()).toBe(operationCount);

    await db.query('DROP TRIGGER fail_hvac_propagation');
    const updated = await service.update(gateway.id, { expectedRevision: 1, ip: '10.0.0.11' }, 'fixture-admin');
    expect(updated.configRevision).toBe(2);
    expect(await db.getRepository(Device).findOneByOrFail({ id: indoor.id }))
      .toMatchObject({ address: '{"gwHost":"10.0.0.11","n":1}' });
  });
});
