import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { resolve } from 'path';
import { assertSchemaReady } from '../../common/config/schema-readiness';

describe('complete migration chain on an isolated database', () => {
  let db: DataSource;
  afterEach(async () => { if (db?.isInitialized) await db.destroy(); });
  it('creates the multiuser tables through real migrations without synchronize', async () => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: false,
      migrations: [resolve(__dirname, '../../migrations/*.ts')],
      entities: [resolve(__dirname, '../../entities/*.entity.ts')],
    }).initialize();
    const applied = await db.runMigrations();
    expect(applied.length).toBeGreaterThan(4);
    expect(await db.showMigrations()).toBe(false);
    expect(await db.query("SELECT visibility, source, owner_user_id FROM media_assets WHERE sourceUrl = ?", [
      'http://localhost:5173/control/park-ops/index.html',
    ])).toEqual([{ visibility: 'shared', source: 'system', owner_user_id: null }]);
    await db.query(
      `INSERT INTO users (username, password, role, enabled, created_at, updated_at)
       VALUES ('test-admin', 'test-only-non-login-hash', 'admin', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    );
    expect(() => assertSchemaReady((db.driver as any).databaseConnection)).not.toThrow();
    const runner = db.createQueryRunner();
    expect((await runner.getTable('media_assets'))?.findColumnByName('owner_user_id')).toBeDefined();
    expect((await runner.getTable('playlist_item'))?.indices.map(i => i.name)).toContain('uq_playlist_user_slot_media');
    expect((await runner.getTable('playback_channels'))?.findColumnByName('playback_session')).toBeDefined();
    expect(await runner.hasTable('upload_reservations')).toBe(true);
    for (const entity of db.entityMetadatas) {
      const table = await runner.getTable(entity.tableName);
      expect(table).toBeDefined();
      for (const column of entity.columns) expect(table?.findColumnByName(column.databaseName)).toBeDefined();
    }
    expect(await db.runMigrations()).toEqual([]);
    // Empty new-feature state can return to the pre-multiuser schema without data loss.
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('temp_name')).toBeDefined();
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('instance_id')).toBeDefined();
    expect(await runner.hasTable('upload_instances')).toBe(true);
    expect((await runner.getTable('upload_reservations'))?.findColumnByName('target_media_id')).toBeDefined();
    expect(await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'")).toHaveLength(2);
    // HVAC/playback and operational catalogs are forward-only: remove only their ledger
    // entries in this disposable fixture after proving the rollback fences, so earlier
    // rollback fences remain testable.
    await expect(db.undoLastMigration()).rejects.toThrow(
      'HVAC_PLAYBACK_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query("DELETE FROM migrations WHERE name = 'EstablishHvacPlaybackCatalog1789670000000'");
    await expect(db.undoLastMigration()).rejects.toThrow(
      'OPERATIONAL_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query("DELETE FROM migrations WHERE name = 'EstablishOperationalCatalog1789660000000'");
    // Named identity is forward-only: remove only its ledger entry in this disposable
    // fixture after proving the rollback fence, so earlier rollback fences remain testable.
    await expect(db.undoLastMigration()).rejects.toThrow(
      'NAMED_IDENTITY_AUTHORITY_ROLLBACK_PROHIBITED',
    );
    await db.query("DELETE FROM migrations WHERE name = 'EstablishNamedIdentityAuthority1789650000000'");
    // App release, audio, brand and driver catalogs, power configuration and runtime documents are authoritative:
    // each rollback boundary requires a matched archive before its data can be removed.
    await expect(db.undoLastMigration()).rejects.toThrow(
      'APP_RELEASE_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query('DELETE FROM app_release_v1');
    await db.undoLastMigration();
    await expect(db.undoLastMigration()).rejects.toThrow(
      'AUDIO_CONFIG_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    for (const table of [
      'audio_output_zone',
      'audio_input_source',
      'audio_desired_link',
      'audio_scene',
    ]) await db.query(`DELETE FROM ${table}`);
    await db.undoLastMigration();
    await expect(db.undoLastMigration()).rejects.toThrow(
      'BRAND_CATALOG_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query('DELETE FROM brands');
    await db.undoLastMigration();
    await expect(db.undoLastMigration()).rejects.toThrow(
      'BUILTIN_DRIVER_TEMPLATE_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query('DELETE FROM driver_templates');
    await db.undoLastMigration();
    await expect(db.undoLastMigration()).rejects.toThrow(
      'POWER_CIRCUIT_ROLLBACK_REQUIRES_ARCHIVE',
    );
    await db.query('DELETE FROM power_circuit');
    await db.undoLastMigration();
    await expect(db.undoLastMigration()).rejects.toThrow(
      'VIDEO_BINDING_ROLLBACK_REQUIRES_ARCHIVE',
    );
    // This isolated fixture has been "archived" by the assertion above; remove only its
    // deterministic default row so older migration down paths can still be exercised.
    await db.query(
      "DELETE FROM runtime_config_revisions WHERE config_key = 'video.binding' AND source = 'built-in-default'",
    );
    await db.query("DELETE FROM runtime_config_documents WHERE config_key = 'video.binding'");
    await db.undoLastMigration();
    const multiuserAndLater = applied.filter(
      m =>
        m.timestamp >= 1788618000000 &&
        ![
          'EnsureVideoBindingRuntimeConfig1789590000000',
          'EstablishBuiltinDriverTemplates1789610000000',
          'EstablishBrandCatalog1789620000000',
          'EstablishAudioConfigCatalog1789630000000',
          'EstablishAppReleaseCatalog1789640000000',
          'EstablishNamedIdentityAuthority1789650000000',
          'EstablishOperationalCatalog1789660000000',
          'EstablishHvacPlaybackCatalog1789670000000',
        ].includes(m.name),
    );
    for (const _migration of multiuserAndLater) await db.undoLastMigration();
    expect(await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'")).toHaveLength(0);
    expect(await runner.hasTable('upload_reservations')).toBe(false);
    expect((await runner.getTable('media_assets'))?.findColumnByName('owner_user_id')).toBeUndefined();
    expect(() => assertSchemaReady((db.driver as any).databaseConnection)).toThrow('schema is not ready');
  });
  it.each(['empty', 'ledger', 'column', 'trigger'])('rejects %s schema without silently repairing it', async damage => {
    db = await new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: false,
      migrations: [resolve(__dirname, '../../migrations/*.ts')],
    }).initialize();
    if (damage !== 'empty') await db.runMigrations();
    if (damage === 'ledger') await db.query("DELETE FROM migrations WHERE name = 'TrackSystemUploadReservations1788618008000'");
    if (damage === 'column') await db.query('ALTER TABLE media_assets DROP COLUMN processingError');
    if (damage === 'trigger') {
      const [trigger] = await db.query("SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'protect_last_administrator_%'");
      await db.query(`DROP TRIGGER "${trigger.name}"`);
    }
    const before = await db.query('SELECT type, name, sql FROM sqlite_master ORDER BY name');
    expect(() => assertSchemaReady((db.driver as any).databaseConnection)).toThrow('schema is not ready');
    expect(await db.query('SELECT type, name, sql FROM sqlite_master ORDER BY name')).toEqual(before);
  });
});
