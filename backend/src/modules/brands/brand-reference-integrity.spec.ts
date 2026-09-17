import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { Brand } from '../../entities/brand.entity';
import { Device } from '../../entities/device.entity';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { HardwareService } from '../hardware/hardware.service';
import { DriverRegistryService } from '../drivers/driver-registry.service';
import { BrandsService } from './brands.service';

const hardwareInput = (code: string, vendor = 'Exact Vendor') => ({
  code,
  name: code,
  category: 'other' as const,
  model: 'synthetic',
  vendor,
});
const driverInput = (kind: string, vendor = 'Exact Vendor') => ({
  kind,
  vendor,
  displayName: kind,
  category: 'custom',
  protocol: 'custom',
  capabilities: [],
});
const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

describe('brand reference transaction boundary (synthetic SQLite, no hardware I/O)', () => {
  let db: DataSource,
    brands: BrandsService,
    hardware: HardwareService,
    drivers: DriverRegistryService;
  let log: jest.Mock;
  beforeEach(async () => {
    db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: true,
      entities: [Brand, HardwareUnit, DriverTemplate, Device],
    }).initialize();
    brands = new BrandsService(
      db.getRepository(Brand),
      db.getRepository(HardwareUnit),
      db.getRepository(DriverTemplate),
    );
    log = jest.fn(async () => undefined);
    hardware = new HardwareService(
      db.getRepository(HardwareUnit),
      db.getRepository(Device),
      { record: log } as never,
      brands,
      { info: jest.fn() } as never,
    );
    drivers = new DriverRegistryService(db.getRepository(DriverTemplate), brands);
  });
  afterEach(async () => {
    await db.destroy();
  });

  async function assertNoOrphans() {
    for (const table of ['hardware_units', 'driver_templates']) {
      expect(
        await db.query(`SELECT r.vendor FROM ${table} r LEFT JOIN brands b ON b.name = r.vendor
        WHERE trim(r.vendor) != '' AND b.id IS NULL`),
      ).toEqual([]);
    }
  }

  it('preserves exact vendor keys, maintained metadata and disabled state when creating references', async () => {
    const vendor = ' Exact Vendor ';
    await brands.create({
      name: vendor,
      displayName: 'Kept',
      enabled: false,
      remark: 'Maintained',
      logoUrl: '/media/test.png',
    });
    const before = await db.getRepository(Brand).findOneByOrFail({ name: vendor });
    await hardware.create(hardwareInput('hw', vendor));
    await drivers.createNonBuiltin(driverInput('driver', vendor));
    expect(await db.getRepository(Brand).findOneByOrFail({ name: vendor })).toEqual(before);
    expect(await brands.detail(before.id)).toMatchObject({ hardwareCount: 1, driverCount: 1 });
    expect(await db.getRepository(Brand).count()).toBe(1);
    await assertNoOrphans();
  });

  it('rolls back a newly established brand if the hardware insertion or duplicate check fails', async () => {
    await hardware.create(hardwareInput('existing'));
    await expect(
      hardware.create(hardwareInput('existing', 'Never persisted')),
    ).rejects.toMatchObject({ status: 409 });
    await db.query(
      "CREATE TRIGGER reject_hw BEFORE INSERT ON hardware_units WHEN NEW.code = 'failure' BEGIN SELECT RAISE(ABORT, 'synthetic hardware failure'); END",
    );
    await expect(hardware.create(hardwareInput('failure', 'Never persisted'))).rejects.toThrow(
      'synthetic hardware failure',
    );
    expect(await db.getRepository(Brand).countBy({ name: 'Never persisted' })).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
    await hardware.create(hardwareInput('after-rollback', 'Next Vendor'));
    await assertNoOrphans();
  });

  it('rolls back vendor changes and newly established brands when hardware update fails', async () => {
    const row = await hardware.create(hardwareInput('hw'));
    await db.query(
      "CREATE TRIGGER reject_hw_update BEFORE UPDATE ON hardware_units BEGIN SELECT RAISE(ABORT, 'synthetic update failure'); END",
    );
    await expect(
      hardware.update(row.id, { vendor: 'Not committed', model: 'changed' }),
    ).rejects.toThrow('synthetic update failure');
    expect(await hardware.findOne(row.id)).toEqual(row);
    expect(await db.getRepository(Brand).countBy({ name: 'Not committed' })).toBe(0);
    expect(log).toHaveBeenCalledTimes(1);
  });

  it('does not leave a new brand behind for a missing hardware row', async () => {
    await expect(hardware.update(999, { vendor: 'Not committed' })).rejects.toMatchObject({
      status: 404,
    });
    expect(await brands.list()).toEqual([]);
  });

  it('rolls back new brands for duplicate, failed and unserializable custom drivers', async () => {
    await drivers.createNonBuiltin(driverInput('existing'));
    await expect(
      drivers.createNonBuiltin(driverInput('existing', 'Never persisted')),
    ).rejects.toThrow('已存在');
    await db.query(
      "CREATE TRIGGER reject_driver BEFORE INSERT ON driver_templates WHEN NEW.kind = 'failure' BEGIN SELECT RAISE(ABORT, 'synthetic driver failure'); END",
    );
    await expect(
      drivers.createNonBuiltin(driverInput('failure', 'Never persisted')),
    ).rejects.toThrow('synthetic driver failure');
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    await expect(
      drivers.createNonBuiltin({
        ...driverInput('circular', 'Never persisted'),
        defaultAddressing: circular,
      }),
    ).rejects.toThrow(/circular/i);
    expect(await db.getRepository(Brand).countBy({ name: 'Never persisted' })).toBe(0);
    await assertNoOrphans();
  });

  it.each(['hardware', 'driver'] as const)(
    'rejects rename and delete of brands referenced by disabled %s rows',
    async (kind) => {
      if (kind === 'hardware') await hardware.create({ ...hardwareInput('hw'), enabled: false });
      else {
        const driver = await drivers.createNonBuiltin(driverInput('driver'));
        await db.getRepository(DriverTemplate).update(driver.id, { enabled: false, builtin: true });
      }
      const row = (await brands.list())[0];
      const before = await db.getRepository(Brand).findOneByOrFail({ id: row.id });
      await expect(
        brands.update(row.id, { name: 'Broken link', displayName: 'Not saved' }),
      ).rejects.toMatchObject({ status: 409, response: { code: 'BRAND_REFERENCED' } });
      await expect(brands.remove(row.id)).rejects.toMatchObject({
        status: 409,
        response: { code: 'BRAND_REFERENCED' },
      });
      expect(await db.getRepository(Brand).findOneByOrFail({ id: row.id })).toEqual(before);
      await assertNoOrphans();
    },
  );

  it('permits display metadata changes and disabling without changing linked hardware or driver rows', async () => {
    const hw = await hardware.create(hardwareInput('hw'));
    const driver = await drivers.createNonBuiltin(driverInput('driver'));
    const row = (await brands.list())[0];
    expect(
      await brands.update(row.id, { name: row.name, displayName: 'Friendly name', enabled: false }),
    ).toMatchObject({
      name: row.name,
      displayName: 'Friendly name',
      enabled: false,
      hardwareCount: 1,
      driverCount: 1,
    });
    expect(await hardware.findOne(hw.id)).toEqual(hw);
    expect(await drivers.detail(driver.kind)).toEqual(driver);
  });

  it.each([null, '', '   ', 42, 'x'.repeat(129)])(
    'cannot bypass reference protection with invalid name %p',
    async (name) => {
      await hardware.create(hardwareInput('hw'));
      const row = (await brands.list())[0];
      await expect(brands.update(row.id, { name: name as string })).rejects.toMatchObject({
        status: 400,
      });
      await expect(brands.create({ name: name as string })).rejects.toMatchObject({ status: 400 });
      expect((await brands.detail(row.id)).name).toBe(row.name);
      await assertNoOrphans();
    },
  );

  it('allows rename/delete only after both hardware and driver references are removed', async () => {
    const hw = await hardware.create(hardwareInput('hw'));
    const driver = await drivers.createNonBuiltin(driverInput('driver'));
    const row = (await brands.list())[0];
    await hardware.remove(hw.id);
    await expect(brands.remove(row.id)).rejects.toMatchObject({ status: 409 });
    await drivers.deleteNonBuiltin(driver.kind);
    expect(await brands.update(row.id, { name: 'Unreferenced renamed' })).toMatchObject({
      hardwareCount: 0,
      driverCount: 0,
    });
    await brands.remove(row.id);
    await brands.remove(row.id);
    expect(await brands.list()).toEqual([]);
  });

  it.each(['rename', 'delete'] as const)(
    'serializes %s after an in-flight reference write, including another service instance',
    async (operation) => {
      const row = await brands.create({ name: 'Exact Vendor' });
      const started = deferred(),
        release = deferred();
      const write = brands.withReference(row.name, async (manager) => {
        started.resolve();
        await release.promise;
        return manager.save(HardwareUnit, hardwareInput('hw'));
      });
      await started.promise;
      const other = new BrandsService(
        db.getRepository(Brand),
        db.getRepository(HardwareUnit),
        db.getRepository(DriverTemplate),
      );
      let settled = false;
      const pending = (
        operation === 'rename' ? other.update(row.id, { name: 'Changed' }) : other.remove(row.id)
      ).then(
        () => {
          settled = true;
          return null;
        },
        (error: unknown) => {
          settled = true;
          return error;
        },
      );
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(settled).toBe(false);
      release.resolve();
      await write;
      expect(await pending).toMatchObject({ status: 409, response: { code: 'BRAND_REFERENCED' } });
      await assertNoOrphans();
    },
  );

  it.each(['rename', 'delete'] as const)(
    'a new reference after completed %s establishes its exact old vendor key again',
    async (operation) => {
      const row = await brands.create({ name: 'Exact Vendor' });
      await Promise.all([
        operation === 'rename' ? brands.update(row.id, { name: 'Changed' }) : brands.remove(row.id),
        hardware.create(hardwareInput('hw')),
        drivers.createNonBuiltin(driverInput('driver')),
      ]);
      const restored = await db.getRepository(Brand).findOneByOrFail({ name: row.name });
      expect(restored.id).not.toBe(row.id);
      expect(await brands.detail(restored.id)).toMatchObject({ hardwareCount: 1, driverCount: 1 });
      await assertNoOrphans();
    },
  );

  it('queued partial hardware edits read the committed row rather than restoring a stale vendor', async () => {
    const row = await hardware.create(hardwareInput('hw'));
    await Promise.all([
      hardware.update(row.id, { vendor: 'New Vendor' }),
      hardware.update(row.id, { name: 'Renamed hardware' }),
    ]);
    expect(await hardware.findOne(row.id)).toMatchObject({
      vendor: 'New Vendor',
      name: 'Renamed hardware',
    });
    const old = await db.getRepository(Brand).findOneByOrFail({ name: row.vendor });
    await brands.remove(old.id);
    await assertNoOrphans();
  });

  it('concurrent distinct reference writers share a catalog row and duplicate writers do not break it', async () => {
    const results = await Promise.allSettled([
      hardware.create(hardwareInput('hw')),
      hardware.create(hardwareInput('hw')),
      drivers.createNonBuiltin(driverInput('driver')),
      drivers.createNonBuiltin(driverInput('driver')),
    ]);
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(2);
    expect(await brands.list()).toHaveLength(1);
    expect((await brands.list())[0]).toMatchObject({ hardwareCount: 1, driverCount: 1 });
    await assertNoOrphans();
  });

  it('retains the builtin driver deletion restriction', async () => {
    const driver = await drivers.createNonBuiltin(driverInput('builtin'));
    await db.getRepository(DriverTemplate).update(driver.id, { builtin: true });
    await expect(drivers.deleteNonBuiltin(driver.kind)).rejects.toThrow('不能删除 builtin');
    expect(await drivers.detail(driver.kind)).not.toBeNull();
    await assertNoOrphans();
  });
});
