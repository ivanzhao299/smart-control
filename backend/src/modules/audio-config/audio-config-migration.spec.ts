import { createHash } from 'crypto';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DataSource } from 'typeorm';
import { AudioDesiredLink } from '../../entities/audio-desired-link.entity';
import { AudioInputSource } from '../../entities/audio-input-source.entity';
import { AudioOutputZone } from '../../entities/audio-output-zone.entity';
import { AudioScene } from '../../entities/audio-scene.entity';
import { InitialBaseline1784561601801 } from '../../migrations/1784561601801-InitialBaseline';
import { EstablishAudioConfigCatalog1789630000000 } from '../../migrations/1789630000000-EstablishAudioConfigCatalog';
import { AudioConfigService } from './audio-config.service';
import { AuditLog } from '../../entities/audit-log.entity';
import { AddAudioConfigRevisions1789690000000 } from '../../migrations/1789690000000-AddAudioConfigRevisions';

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

function fingerprint(value: unknown): string {
  return createHash('sha256').update(stableJson(value), 'utf8').digest('hex');
}

const EXPECTED = {
  zones: '070251242a4af7336d412d9179af1f5450ceb7930175b347ca9c9f9da74d3531',
  inputs: '667e03582cae49de39b34214d5ce3179724c2fd44d8df4b369301269b00ad8d0',
  scenes: '7179abb961a2efa549c93880f40b072e602c8cdba54b883a1dce444ed8c7a744',
  links: '4a34c5245196174ca87943ee7509cbda6b5e64fca95d64af49f25efc07c0ae1a',
};

describe('EstablishAudioConfigCatalog migration', () => {
  let directory: string;
  let dataSource: DataSource;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'audio-config-migration-'));
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: join(directory, 'migration.sqlite'),
      entities: [AudioOutputZone, AudioInputSource, AudioScene, AudioDesiredLink, AuditLog],
      migrations: [InitialBaseline1784561601801, EstablishAudioConfigCatalog1789630000000],
      migrationsTableName: 'migrations',
      synchronize: false,
    });
  });

  afterEach(async () => {
    if (dataSource.isInitialized) await dataSource.destroy();
    rmSync(directory, { recursive: true, force: true });
  });

  async function catalogRows(): Promise<Record<string, Array<Record<string, unknown>>>> {
    return {
      zones: await dataSource.query(
        'SELECT channel,name,floor,color,sort_order,enabled FROM audio_output_zone ORDER BY channel',
      ),
      inputs: await dataSource.query(
        `SELECT channel,name,color,sort_order,enabled,desired_gain_db,desired_muted
         FROM audio_input_source ORDER BY channel`,
      ),
      scenes: await dataSource.query(
        'SELECT preset_num,name,hint,content,sort_order,enabled FROM audio_scene ORDER BY preset_num',
      ),
      links: await dataSource.query(
        'SELECT out_ch,in_ch,enabled FROM audio_desired_link ORDER BY out_ch,in_ch',
      ),
    };
  }

  async function resetToPreMigration(sql: string[]): Promise<void> {
    await dataSource.runMigrations();
    await dataSource.query('DELETE FROM migrations WHERE name = ?', [
      'EstablishAudioConfigCatalog1789630000000',
    ]);
    for (const table of [
      'audio_output_zone',
      'audio_input_source',
      'audio_scene',
      'audio_desired_link',
    ]) {
      await dataSource.query(`DELETE FROM ${table}`);
    }
    for (const statement of sql) await dataSource.query(statement);
  }

  it('creates the complete product catalog on a fresh database', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const rows = await catalogRows();

    expect(rows.zones).toHaveLength(8);
    expect(rows.inputs).toHaveLength(8);
    expect(rows.scenes).toHaveLength(12);
    expect(rows.links).toHaveLength(64);
    expect(
      Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, fingerprint(value)])),
    ).toEqual(EXPECTED);
    expect(await dataSource.runMigrations()).toEqual([]);
  });

  it('preserves every non-empty maintained domain byte-for-byte', async () => {
    await dataSource.initialize();
    await resetToPreMigration([
      `INSERT INTO audio_output_zone
       (channel,name,floor,color,sort_order,enabled,"createdAt","updatedAt") VALUES
       (0,'投影仪·左','1F','#111111',10,0,'2026-01-01','2026-01-02'),
       (1,'投影仪·右','1F','#222222',11,0,'2026-01-01','2026-01-02')`,
      `INSERT INTO audio_input_source
       (channel,name,color,sort_order,enabled,desired_gain_db,desired_muted,"createdAt","updatedAt") VALUES
       (0,'现场输入','#333333',20,0,4.96,1,'2026-01-01','2026-01-02')`,
      `INSERT INTO audio_scene
       (preset_num,name,hint,content,sort_order,enabled,"createdAt","updatedAt") VALUES
       (1,'现场场景','保留','{"outputs":[]}',30,0,'2026-01-01','2026-01-02')`,
      `INSERT INTO audio_desired_link (out_ch,in_ch,enabled,updated_at)
       VALUES (7,6,1,'2026-01-02')`,
    ]);
    const before = await catalogRows();

    await dataSource.runMigrations();

    expect(await catalogRows()).toEqual(before);
  });

  it('moves the exact legacy rewiring signature into the one-time migration', async () => {
    await dataSource.initialize();
    await resetToPreMigration([
      `INSERT INTO audio_input_source
       (channel,name,color,sort_order,enabled,desired_gain_db,desired_muted,"createdAt","updatedAt")
       VALUES (0,'中控主机','#123456',99,0,-60,1,'2026-01-01','2026-01-02')`,
      `INSERT INTO audio_output_zone
       (channel,name,floor,color,sort_order,enabled,"createdAt","updatedAt")
       VALUES (0,'旧输出','OLD','#654321',99,0,'2026-01-01','2026-01-02')`,
      `INSERT INTO audio_desired_link (out_ch,in_ch,enabled,updated_at)
       VALUES (7,7,1,'2026-01-02')`,
      `INSERT INTO audio_scene
       (preset_num,name,hint,content,sort_order,enabled,"createdAt","updatedAt")
       VALUES (1,'现场场景','保留',NULL,30,0,'2026-01-01','2026-01-02')`,
    ]);

    await dataSource.runMigrations();

    // Historical catalog assertions remain unchanged; current entities need the additive revision metadata.
    await new AddAudioConfigRevisions1789690000000().up(dataSource.createQueryRunner());
    expect(await dataSource.getRepository(AudioInputSource).count()).toBe(8);
    expect(await dataSource.getRepository(AudioOutputZone).count()).toBe(8);
    expect(await dataSource.getRepository(AudioDesiredLink).count()).toBe(64);
    expect(
      await dataSource.getRepository(AudioScene).findOneByOrFail({ presetNum: 1 }),
    ).toMatchObject({ name: '现场场景', enabled: false });
    expect(
      await dataSource.getRepository(AudioInputSource).findOneByOrFail({ channel: 0 }),
    ).toMatchObject({ name: 'LED大屏·左', color: '#123456', sortOrder: 99, enabled: true });
    expect(
      await dataSource.getRepository(AudioOutputZone).findOneByOrFail({ channel: 0 }),
    ).toMatchObject({
      name: 'LED大屏·左',
      floor: '1F',
      color: '#654321',
      sortOrder: 99,
      enabled: true,
    });
  });

  it('refuses an unarchived rollback while authoritative audio data exists', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    const runner = dataSource.createQueryRunner();
    await expect(new EstablishAudioConfigCatalog1789630000000().down(runner)).rejects.toThrow(
      'AUDIO_CONFIG_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await runner.release();
  });

  it('keeps stereo names valid and updates both sides in one write transaction', async () => {
    await dataSource.initialize();
    await dataSource.runMigrations();
    await new AddAudioConfigRevisions1789690000000().up(dataSource.createQueryRunner());
    const service = new AudioConfigService(
      dataSource.getRepository(AudioOutputZone),
      dataSource.getRepository(AudioInputSource),
      dataSource.getRepository(AudioScene),
    );
    const left = await dataSource.getRepository(AudioOutputZone).findOneByOrFail({ channel: 0 });

    const saved = await service.upsertZone(left.id, { name: '现场大屏' });

    expect(saved.name).toBe('现场大屏·左');
    expect(
      await dataSource.getRepository(AudioOutputZone).findOneByOrFail({ channel: 1 }),
    ).toMatchObject({ name: '现场大屏·右' });
  });
});
