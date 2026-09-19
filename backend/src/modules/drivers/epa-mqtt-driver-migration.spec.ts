import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishBuiltinDriverTemplates1789610000000 } from '../../migrations/1789610000000-EstablishBuiltinDriverTemplates';
import { AddEpaMqttDriverTemplate1789710000000 } from '../../migrations/1789710000000-AddEpaMqttDriverTemplate';

describe('AddEpaMqttDriverTemplate migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'epa-mqtt-driver-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [DriverTemplate],
      migrations: [
        InitialBaseline1784561601801,
        EstablishBuiltinDriverTemplates1789610000000,
        AddEpaMqttDriverTemplate1789710000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  it('adds one enabled built-in 4G driver without changing the immutable base catalog', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();

    const row = await dataSource
      .getRepository(DriverTemplate)
      .findOneByOrFail({ kind: 'epa-breaker-mqtt' });
    expect(row).toMatchObject({
      category: 'power-breaker-4g',
      protocol: 'mqtt-json',
      vendor: 'ePa',
      builtin: true,
      enabled: true,
    });
    expect(JSON.parse(row.capabilitiesJson)).toEqual(
      expect.arrayContaining(['turn_on', 'turn_off', 'get_status', 'get_measurements']),
    );
    expect(JSON.parse(row.defaultAddressingJson ?? '{}')).toEqual({
      gatewayId: '',
      clientId: '',
    });
    expect(await dataSource.getRepository(DriverTemplate).count()).toBe(9);
    expect(await dataSource.runMigrations()).toEqual([]);

    await dataSource.undoLastMigration();
    expect(
      await dataSource.getRepository(DriverTemplate).findOneBy({ kind: 'epa-breaker-mqtt' }),
    ).toBeNull();
    expect(await dataSource.getRepository(DriverTemplate).count()).toBe(8);
  });
});
