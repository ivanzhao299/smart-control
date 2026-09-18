import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive only: preserves exact vendor keys, contacts and disabled state. */
export class AddBrandConfigRevision1789710000000 implements MigrationInterface {
  name = 'AddBrandConfigRevision1789710000000';
  async up(runner: QueryRunner): Promise<void> {
    const columns: Array<{ name: string; type: string; notnull: number; dflt_value: unknown }> =
      await runner.query('PRAGMA table_info(brands)');
    if (!columns.length) throw new Error('BRAND_CONFIG_REVISION_TABLE_MISSING');
    const revision = columns.find((column) => column.name === 'config_revision');
    if (!revision)
      await runner.query(
        'ALTER TABLE brands ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1',
      );
    else if (
      !/^(integer|int)$/i.test(revision.type) ||
      revision.notnull !== 1 ||
      String(revision.dflt_value) !== '1'
    )
      throw new Error('BRAND_CONFIG_REVISION_SCHEMA_INVALID');
    if (
      (
        await runner.query(
          "SELECT id FROM brands WHERE typeof(config_revision) != 'integer' OR config_revision < 1 OR config_revision > 9007199254740991 LIMIT 1",
        )
      ).length
    )
      throw new Error('BRAND_CONFIG_REVISION_INVALID');
  }
  async down(): Promise<void> {
    throw new Error('BRAND_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  }
}
