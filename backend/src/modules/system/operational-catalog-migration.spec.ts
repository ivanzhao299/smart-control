import { createHash } from 'crypto';
import { DataSource } from 'typeorm';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishOperationalCatalog1789660000000 } from '../../migrations/1789660000000-EstablishOperationalCatalog';
import catalog from '../../migrations/catalogs/operational-catalog-v1.json';

const CATALOG_SHA256 = '6b715cec7340877627bb1268becda68c182ba114c1f62d1d2d4a216180651bee';

describe('EstablishOperationalCatalog migration', () => {
  let dataSource: DataSource;

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  const create = (withCatalog: boolean) =>
    new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: withCatalog
        ? [InitialBaseline1784561601801, EstablishOperationalCatalog1789660000000]
        : [InitialBaseline1784561601801],
      migrationsTableName: 'migrations',
    });

  it('establishes the immutable fresh-install catalog once', async () => {
    expect(createHash('sha256').update(JSON.stringify(catalog)).digest('hex')).toBe(
      CATALOG_SHA256,
    );
    dataSource = await create(true).initialize();
    await dataSource.runMigrations();

    const count = async (table: string) =>
      Number((await dataSource.query(`SELECT COUNT(*) AS count FROM "${table}"`))[0].count);
    expect(await count('scenes')).toBe(4);
    expect(await count('scene_actions')).toBe(142);
    expect(await count('devices')).toBe(38);
    expect(await count('hardware_units')).toBe(33);
    expect(await count('light_zone')).toBe(7);
    expect(await count('light_group')).toBe(10);
    expect(await count('uat_records')).toBe(16);
    expect(
      await dataSource.query(
        `SELECT s.code, COUNT(a.id) AS count
         FROM scenes s LEFT JOIN scene_actions a ON a.scene_id = s.id
         GROUP BY s.id ORDER BY s.code`,
      ),
    ).toEqual([
      { code: 'closing', count: 30 },
      { code: 'opening', count: 43 },
      { code: 'reception', count: 40 },
      { code: 'roadshow', count: 29 },
    ]);
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('preserves maintained and custom rows while applying exact historical signatures', async () => {
    dataSource = await create(false).initialize();
    await dataSource.runMigrations();
    await dataSource.query(
      `INSERT INTO scenes (code, name, description, enabled, created_at, updated_at)
       VALUES ('opening', '现场开馆', 'keep scene', 0, '2026-01-01', '2026-01-02'),
              ('custom-scene', '自定义场景', 'keep custom', 1, '2026-01-03', '2026-01-04'),
              ('meeting', '现场会议', 'keep retired code', 1, '2026-01-05', '2026-01-06')`,
    );
    const [{ id: openingId }] = await dataSource.query(
      "SELECT id FROM scenes WHERE code = 'opening'",
    );
    await dataSource.query(
      `INSERT INTO scene_actions
       (scene_id, device_type, device_id, command, params, delay_ms, sort_order, enabled,
        created_at, updated_at)
       VALUES (?, 'custom', 'site-device', 'keep', '{"site":true}', 7, 9, 0,
               '2026-01-01', '2026-01-02')`,
      [openingId],
    );
    await dataSource.query(
      `INSERT INTO devices
       (name, category, protocol, adapter, ip, address, floor, zone, enabled, status,
        debug_remark, created_at, updated_at)
       VALUES ('light_1f_lobby', 'lighting', 'site-protocol', 'site-adapter', '10.0.0.1',
               'site-address', 'X', 'site-zone', 0, 'disabled', 'keep device',
               '2026-01-01', '2026-01-02')`,
    );
    await dataSource.query(
      `INSERT INTO hardware_units
       (code, name, category, vendor, model, driverKind, ip, addressing, status, enabled,
        remark, created_at, updated_at)
       VALUES
       ('LED-NOVA-1', 'site led', 'led-controller', 'site', 'VX1000', 'site-driver',
        '10.0.0.2', '{"groups":[99]}', 'fault', 0, 'keep hardware', '2026-01-01', '2026-01-02'),
       ('CONV-RTU-1', 'site rtu', 'rtu-tcp-converter', 'site', 'site-model', NULL,
        '192.168.0.7', '{}', 'normal', 1, 'exact repairs', '2026-01-01', '2026-01-02')`,
    );
    await dataSource.query(
      `INSERT INTO light_zone
       (code, name, floor, sort_order, icon, description, enabled, created_at, updated_at)
       VALUES ('front-hall', '现场前厅', 'SITE', 999, 'SiteIcon', 'keep zone', 0,
               '2026-01-01', '2026-01-02'),
              ('custom-zone', '自定义分区', 'SITE', 1000, NULL, 'keep custom', 1,
               '2026-01-03', '2026-01-04'),
              ('2f-test-a', '现场保留分区', '2F', 1, NULL, NULL, 1,
               '2026-01-05', '2026-01-06')`,
    );
    await dataSource.query(
      `INSERT INTO light_group
       (gateway_code, dali_group, zone_code, shorts, sort_order, enabled, created_at, updated_at)
       VALUES ('GW-DALI-2', 1, 'custom-zone', '[1,2]', 777, 0, '2026-01-01', '2026-01-02')`,
    );
    await dataSource.query(
      `INSERT INTO uat_records
       (item_name, category, test_step, expected_result, actual_result, status, tester,
        remark, sort_order, created_at, updated_at)
       VALUES ('场景: 开馆模式', 'other', 'site step', 'site expected', 'passed here',
               'passed', 'tester', 'keep uat', 999, '2026-01-01', '2026-01-02')`,
    );

    const preservedBefore = await dataSource.query(
      `SELECT
         (SELECT json_object('name', name, 'description', description, 'enabled', enabled,
                             'created_at', created_at, 'updated_at', updated_at)
          FROM scenes WHERE code = 'opening') AS scene,
         (SELECT json_object('protocol', protocol, 'adapter', adapter, 'ip', ip,
                             'debug_remark', debug_remark, 'enabled', enabled, 'status', status,
                             'created_at', created_at, 'updated_at', updated_at)
          FROM devices WHERE name = 'light_1f_lobby') AS device,
         (SELECT json_object('name', name, 'floor', floor, 'sort_order', sort_order,
                             'icon', icon, 'description', description, 'enabled', enabled,
                             'created_at', created_at, 'updated_at', updated_at)
          FROM light_zone WHERE code = 'front-hall') AS zone,
         (SELECT json_object('zone_code', zone_code, 'shorts', shorts, 'sort_order', sort_order,
                             'enabled', enabled, 'created_at', created_at, 'updated_at', updated_at)
          FROM light_group WHERE gateway_code = 'GW-DALI-2' AND dali_group = 1) AS lightGroup,
         (SELECT json_object('category', category, 'test_step', test_step,
                             'expected_result', expected_result, 'actual_result', actual_result,
                             'status', status, 'tester', tester, 'remark', remark,
                             'sort_order', sort_order, 'created_at', created_at,
                             'updated_at', updated_at)
          FROM uat_records WHERE item_name = '场景: 开馆模式') AS uat`,
    );

    const migration = new EstablishOperationalCatalog1789660000000();
    const runner = dataSource.createQueryRunner();
    await migration.up(runner);
    expect(
      await dataSource.query(
        `SELECT
           (SELECT json_object('name', name, 'description', description, 'enabled', enabled,
                               'created_at', created_at, 'updated_at', updated_at)
            FROM scenes WHERE code = 'opening') AS scene,
           (SELECT json_object('protocol', protocol, 'adapter', adapter, 'ip', ip,
                               'debug_remark', debug_remark, 'enabled', enabled, 'status', status,
                               'created_at', created_at, 'updated_at', updated_at)
            FROM devices WHERE name = 'light_1f_lobby') AS device,
           (SELECT json_object('name', name, 'floor', floor, 'sort_order', sort_order,
                               'icon', icon, 'description', description, 'enabled', enabled,
                               'created_at', created_at, 'updated_at', updated_at)
            FROM light_zone WHERE code = 'front-hall') AS zone,
           (SELECT json_object('zone_code', zone_code, 'shorts', shorts, 'sort_order', sort_order,
                               'enabled', enabled, 'created_at', created_at, 'updated_at', updated_at)
            FROM light_group WHERE gateway_code = 'GW-DALI-2' AND dali_group = 1) AS lightGroup,
           (SELECT json_object('category', category, 'test_step', test_step,
                               'expected_result', expected_result, 'actual_result', actual_result,
                               'status', status, 'tester', tester, 'remark', remark,
                               'sort_order', sort_order, 'created_at', created_at,
                               'updated_at', updated_at)
            FROM uat_records WHERE item_name = '场景: 开馆模式') AS uat`,
      ),
    ).toEqual(preservedBefore);
    expect(await dataSource.query("SELECT code FROM scenes WHERE code = 'meeting'")).toEqual([
      { code: 'meeting' },
    ]);
    expect(await dataSource.query("SELECT code FROM light_zone WHERE code = '2f-test-a'")).toEqual([
      { code: '2f-test-a' },
    ]);
    expect(await dataSource.query("SELECT code FROM light_zone WHERE code = 'custom-zone'")).toEqual(
      [{ code: 'custom-zone' }],
    );
    expect(
      await dataSource.query(
        "SELECT model, driverKind FROM hardware_units WHERE code = 'LED-NOVA-1'",
      ),
    ).toEqual([{ model: 'V2460', driverKind: 'site-driver' }]);
    expect(
      await dataSource.query(
        "SELECT ip, driverKind FROM hardware_units WHERE code = 'CONV-RTU-1'",
      ),
    ).toEqual([{ ip: '192.168.50.20', driverKind: 'cy-dali64a' }]);

    const afterFirst = await Promise.all(
      ['scenes', 'scene_actions', 'devices', 'hardware_units', 'light_zone', 'light_group', 'uat_records'].map(
        (table) => dataSource.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );
    await migration.up(runner);
    const afterSecond = await Promise.all(
      ['scenes', 'scene_actions', 'devices', 'hardware_units', 'light_zone', 'light_group', 'uat_records'].map(
        (table) => dataSource.query(`SELECT * FROM "${table}" ORDER BY id`),
      ),
    );
    expect(afterSecond).toEqual(afterFirst);
    await expect(migration.down()).rejects.toThrow(
      'OPERATIONAL_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });
});
