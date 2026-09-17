import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive revision metadata only. Never rewrite hardware addressing or circuit defaults. */
export class AddPowerConfigRevision1789700000000 implements MigrationInterface {
  name = 'AddPowerConfigRevision1789700000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const columns: Array<{ name: string; type: string; notnull: number; dflt_value: unknown }> =
      await queryRunner.query('PRAGMA table_info("power_circuit")');
    if (!columns.length) throw new Error('POWER_CONFIG_REVISION_TABLE_MISSING');
    const revision = columns.find((column) => column.name === 'config_revision');
    if (!revision) {
      await queryRunner.query(
        'ALTER TABLE power_circuit ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1',
      );
    } else if (
      !/^(integer|int)$/i.test(revision.type) ||
      revision.notnull !== 1 ||
      String(revision.dflt_value) !== '1'
    ) {
      throw new Error('POWER_CONFIG_REVISION_SCHEMA_INVALID');
    }
    const invalid = await queryRunner.query(
      "SELECT id FROM power_circuit WHERE typeof(config_revision) != 'integer' OR config_revision < 1 OR config_revision > 9007199254740991 LIMIT 1",
    );
    if (invalid.length) throw new Error('POWER_CONFIG_REVISION_INVALID');
  }
  async down(): Promise<void> {
    throw new Error('POWER_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  }
}
