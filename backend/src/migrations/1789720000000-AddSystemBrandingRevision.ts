import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive only; do not normalize legacy text, images, IDs or archived layout. */
export class AddSystemBrandingRevision1789720000000 implements MigrationInterface {
  name = 'AddSystemBrandingRevision1789720000000';
  async up(runner: QueryRunner): Promise<void> {
    const columns: Array<{ name: string; type: string; notnull: number; dflt_value: unknown }> =
      await runner.query('PRAGMA table_info(system_branding_v2)');
    if (!columns.length) throw new Error('SYSTEM_BRANDING_REVISION_TABLE_MISSING');
    const revision = columns.find((c) => c.name === 'config_revision');
    if (!revision)
      await runner.query(
        'ALTER TABLE system_branding_v2 ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1',
      );
    else if (
      !/^(integer|int)$/i.test(revision.type) ||
      revision.notnull !== 1 ||
      String(revision.dflt_value) !== '1'
    )
      throw new Error('SYSTEM_BRANDING_REVISION_SCHEMA_INVALID');
    if (
      (
        await runner.query(
          "SELECT id FROM system_branding_v2 WHERE typeof(config_revision) != 'integer' OR config_revision < 1 OR config_revision > 9007199254740991 LIMIT 1",
        )
      ).length
    )
      throw new Error('SYSTEM_BRANDING_REVISION_INVALID');
  }
  async down(): Promise<void> {
    throw new Error('SYSTEM_BRANDING_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  }
}
