import { createHash } from 'crypto';
import { DataSource, QueryRunner } from 'typeorm';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { AddRuntimeConfigStore1789470000000 } from '../../migrations/1789470000000-AddRuntimeConfigStore';
import { ImportParkOpsVisualRuntimeConfig1789580000000 } from '../../migrations/1789580000000-ImportParkOpsVisualRuntimeConfig';
import { normalizeParkOpsConfig, PARK_OPS_VISUAL_CONFIG_KEY } from './park-ops-config';

const fixture = () => ({
  version: 1,
  fitMode: 'stretch',
  phases: [
    {
      id: '1',
      name: '一期',
      zoneName: '智造区',
      color: '#63d9ff',
      fontSize: 15,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  ],
  buildings: [],
  textOverrides: {},
  customTexts: [],
});

async function createBrandingTable(queryRunner: QueryRunner): Promise<void> {
  await queryRunner.query(`CREATE TABLE system_branding_v2 (
    id integer PRIMARY KEY AUTOINCREMENT NOT NULL,
    systemName varchar(80) NOT NULL,
    systemSubtitle varchar(60),
    logoText varchar(4) NOT NULL DEFAULT ('金'),
    logoUrl varchar,
    browserTitle varchar(80),
    copyright varchar(120),
    welcome_media_id integer,
    welcomeGuest varchar(64),
    welcomeTitle varchar(32),
    welcomeTagline varchar(64),
    welcomeBgMediaId integer,
    welcomePhotoMediaId integer,
    parkOpsConfigJson text,
    updatedAt datetime NOT NULL DEFAULT (datetime('now'))
  )`);
}

describe('ImportParkOpsVisualRuntimeConfig migration', () => {
  let dataSource: DataSource;
  let queryRunner: QueryRunner;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: false,
    });
    await dataSource.initialize();
    queryRunner = dataSource.createQueryRunner();
    await createBrandingTable(queryRunner);
    await new AddRuntimeConfigStore1789470000000().up(queryRunner);
  });

  afterEach(async () => {
    await queryRunner.release();
    await dataSource.destroy();
  });

  it('imports the normalized legacy document with matching immutable history', async () => {
    const legacy = JSON.stringify(fixture(), null, 2);
    await queryRunner.query(
      `INSERT INTO system_branding_v2
       (id, systemName, logoText, parkOpsConfigJson) VALUES (1, '现场名称', '现', ?)`,
      [legacy],
    );

    const migration = new ImportParkOpsVisualRuntimeConfig1789580000000();
    await migration.up(queryRunner);
    await migration.up(queryRunner);

    const expected = JSON.stringify(normalizeParkOpsConfig(fixture()));
    const checksum = createHash('sha256').update(expected, 'utf8').digest('hex');
    const document = await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
      key: PARK_OPS_VISUAL_CONFIG_KEY,
    });
    const history = await dataSource.getRepository(RuntimeConfigRevision).find({
      where: { key: PARK_OPS_VISUAL_CONFIG_KEY },
    });
    expect(document).toMatchObject({
      schemaVersion: 1,
      revision: 1,
      document: expected,
      documentSha256: checksum,
    });
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({
      actor: 'migration',
      source: 'legacy-sqlite:system_branding_v2.parkOpsConfigJson',
      documentSha256: checksum,
    });
    expect(
      await queryRunner.query('SELECT systemName, logoText FROM system_branding_v2 WHERE id = 1'),
    ).toEqual([{ systemName: '现场名称', logoText: '现' }]);
  });

  it('creates only the missing branding default row and leaves visual config empty', async () => {
    await new ImportParkOpsVisualRuntimeConfig1789580000000().up(queryRunner);
    expect(
      await queryRunner.query(
        'SELECT systemName, logoText, parkOpsConfigJson FROM system_branding_v2 WHERE id = 1',
      ),
    ).toEqual([
      {
        systemName: '金湖展贸中心 · 智能控制',
        logoText: '金',
        parkOpsConfigJson: null,
      },
    ]);
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
  });

  it('never overwrites an existing authoritative document', async () => {
    const existing = JSON.stringify(normalizeParkOpsConfig(fixture()));
    const checksum = createHash('sha256').update(existing, 'utf8').digest('hex');
    await queryRunner.query(
      `INSERT INTO runtime_config_documents
       (config_key, schema_version, revision, document, document_sha256, created_at, updated_at)
       VALUES (?, 1, 7, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [PARK_OPS_VISUAL_CONFIG_KEY, existing, checksum],
    );
    await queryRunner.query(
      `INSERT INTO system_branding_v2
       (id, systemName, logoText, parkOpsConfigJson) VALUES (1, '现场名称', '现', '{invalid')`,
    );

    await new ImportParkOpsVisualRuntimeConfig1789580000000().up(queryRunner);
    expect(
      await dataSource.getRepository(RuntimeConfigDocument).findOneByOrFail({
        key: PARK_OPS_VISUAL_CONFIG_KEY,
      }),
    ).toMatchObject({ revision: 7, document: existing, documentSha256: checksum });
  });

  it('stops instead of discarding a corrupt legacy document', async () => {
    await queryRunner.query(
      `INSERT INTO system_branding_v2
       (id, systemName, logoText, parkOpsConfigJson) VALUES (1, '现场名称', '现', '{invalid')`,
    );
    await expect(
      new ImportParkOpsVisualRuntimeConfig1789580000000().up(queryRunner),
    ).rejects.toThrow('PARK_OPS_VISUAL_IMPORT_FAILED');
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
  });
});
