import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { DriverTemplate } from '../../entities/driver-template.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishBuiltinDriverTemplates1789610000000 } from '../../migrations/1789610000000-EstablishBuiltinDriverTemplates';

const CATALOG_SHA256 = '51af7d60c4404318768f96b691aeaa418300b45490b52d5a93b6e6bed92e1960';

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

describe('EstablishBuiltinDriverTemplates migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'driver-template-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [DriverTemplate],
      migrations: [InitialBaseline1784561601801, EstablishBuiltinDriverTemplates1789610000000],
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
      'EstablishBuiltinDriverTemplates1789610000000',
    ]);
    await dataSource.query('DELETE FROM driver_templates');
    if (rowsSql) await dataSource.query(rowsSql);
  }

  it('creates the eight built-in templates with the production catalog fingerprint', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();

    const rows = (await dataSource.query(
      `SELECT kind, "displayName", vendor, category, protocol, "capabilitiesJson",
              "defaultAddressingJson", "paramSchemaJson", remark, builtin, enabled
       FROM driver_templates ORDER BY kind`,
    )) as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(8);
    expect(rows.every((row) => row.builtin === 1 && row.enabled === 1)).toBe(true);
    expect(createHash('sha256').update(stableJson(rows), 'utf8').digest('hex')).toBe(
      CATALOG_SHA256,
    );
    const breaker = rows.find((row) => row.kind === 'epa-breaker');
    expect(breaker).toMatchObject({ category: 'power-breaker', protocol: 'modbus-rtu' });
    expect(JSON.parse(String(breaker?.capabilitiesJson))).toEqual(
      expect.arrayContaining(['turn_on', 'turn_off', 'get_status', 'get_measurements']),
    );
    expect(JSON.parse(String(breaker?.defaultAddressingJson))).toMatchObject({ slaveId: 255 });
    expect(JSON.parse(String(breaker?.paramSchemaJson))).toMatchObject({
      ip: { required: true },
      port: { default: 502 },
      slaveId: { default: 255, max: 255 },
    });

    const fusion = rows.find((row) => row.kind === 'fusion-player');
    expect(fusion).toMatchObject({ category: 'projector-fusion', protocol: 'tcp-text' });
    expect(JSON.parse(String(fusion?.capabilitiesJson))).toEqual(
      expect.arrayContaining(['open_window', 'replace_window', 'run_mode', 'set_playlist_current']),
    );
    expect(JSON.parse(String(fusion?.defaultAddressingJson))).toMatchObject({
      port: 63426,
      canvas: 0,
    });
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('fills only missing kinds and preserves existing and custom templates byte-for-byte', async () => {
    await dataSource.initialize();
    await resetToPreMigration(
      `INSERT INTO driver_templates
       (kind, "displayName", vendor, category, protocol, "capabilitiesJson",
        "defaultAddressingJson", "paramSchemaJson", remark, builtin, enabled,
        created_at, updated_at)
       VALUES
       ('cy-dali64a', '现场自定义名称', '现场厂商', 'custom', 'custom-protocol',
        '["custom"]', '{"port":1234}', NULL, 'keep me', 0, 0,
        '2026-01-01 00:00:00', '2026-01-02 00:00:00'),
       ('site-custom', '现场模板', '现场厂商', 'custom', 'custom-protocol',
        '[]', NULL, NULL, NULL, 0, 0,
        '2026-01-03 00:00:00', '2026-01-04 00:00:00')`,
    );

    const before = await dataSource.query(
      `SELECT * FROM driver_templates WHERE kind IN ('cy-dali64a', 'site-custom') ORDER BY kind`,
    );
    await dataSource.runMigrations();
    const after = await dataSource.query(
      `SELECT * FROM driver_templates WHERE kind IN ('cy-dali64a', 'site-custom') ORDER BY kind`,
    );

    expect(after).toEqual(before);
    expect(await dataSource.getRepository(DriverTemplate).count()).toBe(9);
    expect(
      await dataSource.getRepository(DriverTemplate).findOneByOrFail({ kind: 'cy-dali64a' }),
    ).toMatchObject({
      displayName: '现场自定义名称',
      builtin: false,
      enabled: false,
    });
  });

  it('refuses an unarchived rollback while authoritative catalog rows exist', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const runner = dataSource.createQueryRunner();
    await expect(new EstablishBuiltinDriverTemplates1789610000000().down(runner)).rejects.toThrow(
      'BUILTIN_DRIVER_TEMPLATE_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });
});
