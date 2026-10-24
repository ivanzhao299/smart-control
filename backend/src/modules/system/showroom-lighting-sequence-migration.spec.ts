import { DataSource } from 'typeorm';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishOperationalCatalog1789660000000 } from '../../migrations/1789660000000-EstablishOperationalCatalog';
import { AddSceneActionConfigRevision1789717000000 } from '../../migrations/1789717000000-AddSceneActionConfigRevision';
import { EstablishShowroomLightingSequence1793000000000 } from '../../migrations/1793000000000-EstablishShowroomLightingSequence';

describe('EstablishShowroomLightingSequence migration', () => {
  type ActionRow = {
    code: string;
    deviceType: string;
    deviceId: string;
    command: string;
    params: string;
    sortOrder: number;
    enabled: number;
  };
  let dataSource: DataSource;

  afterEach(async () => {
    if (dataSource?.isInitialized) await dataSource.destroy();
  });

  it('adds the six-step power order and one full DALI broadcast per scene', async () => {
    dataSource = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      synchronize: false,
      migrations: [
        InitialBaseline1784561601801,
        EstablishOperationalCatalog1789660000000,
        AddSceneActionConfigRevision1789717000000,
        EstablishShowroomLightingSequence1793000000000,
      ],
      migrationsTableName: 'migrations',
    }).initialize();
    await dataSource.runMigrations();

    const rows = await dataSource.query(
      `SELECT s.code, a.device_type AS deviceType, a.device_id AS deviceId,
              a.command, a.params, a.sort_order AS sortOrder, a.enabled
       FROM scene_actions a JOIN scenes s ON s.id = a.scene_id
       WHERE s.code IN ('opening', 'reception', 'roadshow', 'closing')
         AND a.device_type IN ('power-circuit', 'lighting-broadcast')
       ORDER BY s.code, a.sort_order`,
    );
    const grouped = (rows as ActionRow[]).reduce((map: Record<string, ActionRow[]>, row) => {
      (map[row.code] ??= []).push(row);
      return map;
    }, {});

    for (const code of ['opening', 'reception', 'roadshow']) {
      expect(grouped[code].filter((row) => row.deviceType === 'power-circuit').map((row) => row.deviceId)).toEqual([
        'ewelink-02b88e41', 'ewelink-02b8942a', '1f-showroom',
        'ewelink-02cbf4eb', 'ewelink-02cbf4ef', 'ewelink-02cbf50b',
      ]);
      expect(grouped[code].find((row) => row.deviceType === 'lighting-broadcast')).toMatchObject({
        command: 'setBrightness', sortOrder: 70, enabled: 1,
      });
    }
    expect(grouped.closing.filter((row) => row.deviceType === 'power-circuit').map((row) => row.deviceId)).toEqual([
      'ewelink-02cbf50b', 'ewelink-02cbf4ef', 'ewelink-02cbf4eb',
      '1f-showroom', 'ewelink-02b8942a', 'ewelink-02b88e41',
    ]);
    expect(grouped.closing.find((row) => row.deviceType === 'lighting-broadcast')).toMatchObject({
      command: 'setBrightness', sortOrder: 10, enabled: 1,
    });
    expect(await dataSource.query(
      `SELECT COUNT(*) AS count FROM scene_actions
       WHERE device_type IN ('lighting', 'hvac', 'hvac-zone') AND enabled = 1`,
    )).toEqual([{ count: 0 }]);
  });
});
