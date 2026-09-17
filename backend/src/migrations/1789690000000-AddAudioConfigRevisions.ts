import { MigrationInterface, QueryRunner } from 'typeorm';

/** Additive metadata only: existing configuration and device intent are never rewritten. */
export class AddAudioConfigRevisions1789690000000 implements MigrationInterface {
  name = 'AddAudioConfigRevisions1789690000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['audio_output_zone', 'audio_input_source', 'audio_scene']) {
      const columns: Array<{ name: string; type: string; notnull: number; dflt_value: unknown }> =
        await queryRunner.query(`PRAGMA table_info("${table}")`);
      if (!columns.length) throw new Error(`AUDIO_CONFIG_REVISION_TABLE_MISSING: ${table}`);
      const existing = columns.find((column) => column.name === 'config_revision');
      if (!existing) {
        await queryRunner.query(
          `ALTER TABLE "${table}" ADD COLUMN config_revision INTEGER NOT NULL DEFAULT 1`,
        );
      } else if (
        !/^(integer|int)$/i.test(existing.type) ||
        existing.notnull !== 1 ||
        String(existing.dflt_value) !== '1'
      ) {
        throw new Error(`AUDIO_CONFIG_REVISION_SCHEMA_INVALID: ${table}`);
      }
      const invalid = await queryRunner.query(
        `SELECT id FROM "${table}" WHERE typeof(config_revision) != 'integer' OR config_revision < 1 OR config_revision > 9007199254740991 LIMIT 1`,
      );
      if (invalid.length) throw new Error(`AUDIO_CONFIG_REVISION_INVALID: ${table}`);
    }
  }

  async down(): Promise<void> {
    throw new Error('AUDIO_CONFIG_REVISION_ROLLBACK_REQUIRES_ARCHIVE');
  }
}
