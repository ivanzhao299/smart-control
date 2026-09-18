import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { AuditLog } from '../../entities/audit-log.entity';
import { Brand } from '../../entities/brand.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { BrandsService } from '../brands/brands.service';
import { AuditService } from './audit.service';

describe('hardware audit rollback preserves brand references atomically', () => {
  let db: DataSource, audit: AuditService, brands: BrandsService;
  const adapter = { invalidateConfigCache: jest.fn() };
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [AuditLog, Brand, HardwareUnit, DriverTemplate],
    }).initialize();
    brands = new BrandsService(
      db.getRepository(Brand),
      db.getRepository(HardwareUnit),
      db.getRepository(DriverTemplate),
    );
    audit = new AuditService(
      db.getRepository(AuditLog),
      db.getRepository(HardwareUnit),
      adapter as never,
      adapter as never,
      adapter as never,
      adapter as never,
      { warn: jest.fn() } as never,
      brands,
    );
    adapter.invalidateConfigCache.mockClear();
  });
  afterEach(async () => {
    await db.destroy();
  });
  async function setup() {
    const hardware = await db.getRepository(HardwareUnit).save({
      code: 'synthetic',
      name: 'Current',
      category: 'other',
      model: 'synthetic',
      vendor: 'Current Vendor',
    });
    const event = await audit.record({
      entityType: 'hardware_unit',
      entityId: hardware.id,
      action: 'update',
      snapshotBefore: { ...hardware, vendor: ' Restored exact key ', name: 'Restored' },
    });
    return { hardware, event };
  }
  it('re-establishes the exact historical vendor and then protects it from deletion', async () => {
    const { hardware, event } = await setup();
    expect(await audit.rollback(event.id, 'named-admin')).toMatchObject({
      id: hardware.id,
      vendor: ' Restored exact key ',
      name: 'Restored',
    });
    const brand = await db.getRepository(Brand).findOneByOrFail({ name: ' Restored exact key ' });
    await expect(brands.remove(brand.id, 1)).rejects.toMatchObject({ status: 409 });
    expect(await db.getRepository(AuditLog).findOneBy({ action: 'rollback' })).toMatchObject({
      operator: 'named-admin',
    });
  });
  it('rolls back the new catalog row and hardware when rollback audit insertion fails', async () => {
    const { hardware, event } = await setup();
    await db.query(
      "CREATE TRIGGER reject_rollback BEFORE INSERT ON audit_logs WHEN NEW.action='rollback' BEGIN SELECT RAISE(ABORT,'synthetic rollback audit failure'); END",
    );
    await expect(audit.rollback(event.id)).rejects.toThrow('synthetic rollback audit failure');
    expect(await db.getRepository(HardwareUnit).findOneByOrFail({ id: hardware.id })).toEqual(
      hardware,
    );
    expect(await db.getRepository(Brand).count()).toBe(0);
    expect(await db.getRepository(AuditLog).count()).toBe(1);
    expect(adapter.invalidateConfigCache).not.toHaveBeenCalled();
  });
  it('does not establish a brand for deleted hardware', async () => {
    const { hardware, event } = await setup();
    await db.getRepository(HardwareUnit).delete(hardware.id);
    await expect(audit.rollback(event.id)).rejects.toThrow('已删除');
    expect(await db.getRepository(Brand).count()).toBe(0);
  });
});
