import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { resolveRuntimeDataDir } from '../common/storage/runtime-data-path';
import {
  normalizeVideoBindingConfig,
  VIDEO_BINDING_CONFIG_KEY,
  VIDEO_BINDING_SCHEMA_VERSION,
} from '../modules/cameras/video-binding-config';

export class ImportVideoBindingRuntimeConfig1789560000000 implements MigrationInterface {
  name = 'ImportVideoBindingRuntimeConfig1789560000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [VIDEO_BINDING_CONFIG_KEY],
    );
    if (existing.length) return;

    const dataDir = resolveRuntimeDataDir();
    const candidates = [
      join(dataDir, 'video-binding.json'),
      join(dataDir, 'video-binding.json.bak'),
    ];
    let document: string | null = null;
    let source = '';
    let lastError: unknown;
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      try {
        document = JSON.stringify(
          normalizeVideoBindingConfig(JSON.parse(readFileSync(candidate, 'utf8'))),
        );
        source = `legacy-json:${candidate.endsWith('.bak') ? 'video-binding.json.bak' : 'video-binding.json'}`;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!document) {
      if (lastError) throw new Error(`VIDEO_BINDING_IMPORT_FAILED: ${String(lastError)}`);
      return;
    }
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
       VALUES (?, ?, 1, ?, ?, 'migration', ?, CURRENT_TIMESTAMP)`,
      [VIDEO_BINDING_CONFIG_KEY, VIDEO_BINDING_SCHEMA_VERSION, document, checksum, source],
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
