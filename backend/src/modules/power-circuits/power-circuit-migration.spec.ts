import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishPowerCircuitDefaults1789600000000 } from '../../migrations/1789600000000-EstablishPowerCircuitDefaults';
import { CreatePowerDomains1792300000000 } from '../../migrations/1792300000000-CreatePowerDomains';

describe('EstablishPowerCircuitDefaults migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'power-circuit-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [PowerCircuit],
      // 第五轮：CreatePowerDomains 给 power_circuit 补 domain_code 列，
      // 否则带 domainCode 字段的实体会 SELECT 到旧 schema 缺失列。
      migrations: [
        InitialBaseline1784561601801,
        EstablishPowerCircuitDefaults1789600000000,
        CreatePowerDomains1792300000000,
      ],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  async function resetToPreMigration(rowsSql?: string): Promise<void> {
    await dataSource.runMigrations();
    await dataSource.query('DELETE FROM migrations WHERE name = ?', [
      'EstablishPowerCircuitDefaults1789600000000',
    ]);
    await dataSource.query('DELETE FROM power_circuit');
    if (rowsSql) await dataSource.query(rowsSql);
  }

  it('creates the complete defaults only when the table is empty', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();

    const rows = await dataSource.getRepository(PowerCircuit).find({ order: { code: 'ASC' } });
    expect(rows).toHaveLength(14);
    expect(rows.find((row) => row.code === '1f-led')).toMatchObject({
      gatewayCode: 'BREAKER-LED-1',
      relayChannel: null,
      ratedVoltage: 380,
      ratedCurrent: 40,
      ratedPower: 19000,
    });
    expect(rows.find((row) => row.code === 'seq-4')?.relayChannel).toBe(4);
    expect(rows.find((row) => row.code === 'seq-5')?.relayChannel).toBe(5);
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('preserves a non-empty customized table and does not fill missing default codes', async () => {
    await dataSource.initialize();
    await resetToPreMigration(
      `INSERT INTO power_circuit
       (code, name, floor, category, rated_voltage, rated_current, rated_power, sort_order, enabled)
       VALUES ('custom', 'Custom', '1F', 'misc', 400, 32, 9000, 1, 1)`,
    );

    await dataSource.runMigrations();
    const rows = await dataSource.getRepository(PowerCircuit).find();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ code: 'custom', ratedVoltage: 400, ratedPower: 9000 });
  });

  it('repairs only the exact historical LED and swapped sequencer signatures', async () => {
    await dataSource.initialize();
    await resetToPreMigration(
      `INSERT INTO power_circuit
       (code, name, floor, category, gateway_code, relay_channel, rated_voltage,
        rated_current, rated_power, sort_order, enabled)
       VALUES
       ('1f-led', 'LED', '1F', 'led', 'RELAY-1F-1', 4, 220, 20, 3500, 30, 1),
       ('seq-4', 'Mixer', 'Audio', 'audio-seq', 'AUDIO-PWR-SEQ-1', 5, 220, 16, 2000, 103, 1),
       ('seq-5', 'Projector', 'Audio', 'audio-seq', 'AUDIO-PWR-SEQ-1', 4, 220, 16, 2000, 104, 1)`,
    );

    await dataSource.runMigrations();
    const repo = dataSource.getRepository(PowerCircuit);
    expect(await repo.findOneByOrFail({ code: '1f-led' })).toMatchObject({
      gatewayCode: 'BREAKER-LED-1',
      relayChannel: null,
      ratedVoltage: 380,
      ratedCurrent: 40,
      ratedPower: 19000,
    });
    expect((await repo.findOneByOrFail({ code: 'seq-4' })).relayChannel).toBe(4);
    expect((await repo.findOneByOrFail({ code: 'seq-5' })).relayChannel).toBe(5);
  });

  it('leaves arbitrary channel customization unchanged', async () => {
    await dataSource.initialize();
    await resetToPreMigration(
      `INSERT INTO power_circuit
       (code, name, floor, category, gateway_code, relay_channel, sort_order, enabled)
       VALUES
       ('seq-4', 'Custom 4', 'Audio', 'audio-seq', 'AUDIO-PWR-SEQ-1', 7, 103, 1),
       ('seq-5', 'Custom 5', 'Audio', 'audio-seq', 'AUDIO-PWR-SEQ-1', 8, 104, 1)`,
    );

    await dataSource.runMigrations();
    const repo = dataSource.getRepository(PowerCircuit);
    expect((await repo.findOneByOrFail({ code: 'seq-4' })).relayChannel).toBe(7);
    expect((await repo.findOneByOrFail({ code: 'seq-5' })).relayChannel).toBe(8);
  });
});
