import { createHash } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  defaultVideoBindingConfig,
  VIDEO_BINDING_CONFIG_KEY,
  VIDEO_BINDING_SCHEMA_VERSION,
} from '../modules/cameras/video-binding-config';

/**
 * Fresh installations may have no legacy video-binding.json for the import migration.
 * Establish the database row here so application startup remains read-only.
 */
export class EnsureVideoBindingRuntimeConfig1789590000000 implements MigrationInterface {
  name = 'EnsureVideoBindingRuntimeConfig1789590000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [VIDEO_BINDING_CONFIG_KEY],
    );
    if (existing.length) return;

    const document = JSON.stringify(defaultVideoBindingConfig('1970-01-01T00:00:00.000Z'));
    const checksum = createHash('sha256').update(document, 'utf8').digest('hex');
    await queryRunner.query(
      `INSERT INTO runtime_config_documents
       (config_key, schema_version, revision, document, document_sha256, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [VIDEO_BINDING_CONFIG_KEY, VIDEO_BINDING_SCHEMA_VERSION, document, checksum],
    );
    await queryRunner.query(
      `INSERT INTO runtime_config_revisions
       (config_key, schema_version, revision, document, document_sha256, actor, source, created_at)
       VALUES (?, ?, 1, ?, ?, 'migration', 'built-in-default', CURRENT_TIMESTAMP)`,
      [VIDEO_BINDING_CONFIG_KEY, VIDEO_BINDING_SCHEMA_VERSION, document, checksum],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [VIDEO_BINDING_CONFIG_KEY],
    );
    if (rows.length) {
      throw new Error(
        'VIDEO_BINDING_ROLLBACK_REQUIRES_ARCHIVE: authoritative configuration exists',
      );
    }
  }
}
