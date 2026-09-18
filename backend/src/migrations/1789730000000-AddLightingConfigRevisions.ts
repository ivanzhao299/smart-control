import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive CAS metadata for shared lighting configuration editors. */
export class AddLightingConfigRevisions1789730000000 implements MigrationInterface {
  name = 'AddLightingConfigRevisions1789730000000';

  async up(runner: QueryRunner): Promise<void> {
    for (const table of ['light_zone', 'light_group', 'dali_light', 'light_scene']) {
      const columns: Array<{ name: string; type: string; notnull: number; dflt_value: unknown }> =
        await runner.query(`PRAGMA table_info("${table}")`);
      if (!columns.length) throw new Error(`LIGHTING_CONFIG_REVISION_TABLE_MISSING:${table}`);
      const revision = columns.find((column) => column.name === 'config_revision');
      if (!revision) {
        await runner.query(`ALTER TABLE "${table}" ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1`);
      } else if (!/^(integer|int)$/i.test(revision.type) || revision.notnull !== 1 || String(revision.dflt_value) !== '1') {
        throw new Error(`LIGHTING_CONFIG_REVISION_SCHEMA_INVALID:${table}`);
      }
      const invalid = await runner.query(
        `SELECT id FROM "${table}" WHERE typeof(config_revision) != 'integer' OR config_revision < 1 OR config_revision > 9007199254740991 LIMIT 1`,
      );
      if (invalid.length) throw new Error(`LIGHTING_CONFIG_REVISION_INVALID:${table}`);
    }
  }

  async down(): Promise<void> {
    throw new Error('LIGHTING_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  }
}
