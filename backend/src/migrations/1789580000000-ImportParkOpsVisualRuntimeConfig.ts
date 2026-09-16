import { createHash } from 'crypto';
import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  normalizeParkOpsConfig,
  PARK_OPS_VISUAL_CONFIG_KEY,
  PARK_OPS_VISUAL_SCHEMA_VERSION,
} from '../modules/system-branding/park-ops-config';

interface LegacyBrandingRow {
  parkOpsConfigJson: string | null;
}

export class ImportParkOpsVisualRuntimeConfig1789580000000 implements MigrationInterface {
  name = 'ImportParkOpsVisualRuntimeConfig1789580000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `INSERT OR IGNORE INTO system_branding_v2
       (id, systemName, systemSubtitle, logoText, logoUrl, browserTitle, copyright,
        welcome_media_id, welcomeGuest, welcomeTitle, welcomeTagline, welcomeBgMediaId,
        welcomePhotoMediaId, parkOpsConfigJson, updatedAt)
       VALUES (1, ?, ?, ?, NULL, ?, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, CURRENT_TIMESTAMP)`,
      ['金湖展贸中心 · 智能控制', '智慧展厅中控', '金', '金湖展贸中心 控制系统'],
    );

    const existing = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [PARK_OPS_VISUAL_CONFIG_KEY],
    );
    if (existing.length) return;

    const rows = (await queryRunner.query(
      'SELECT parkOpsConfigJson FROM system_branding_v2 WHERE id = 1 LIMIT 1',
    )) as LegacyBrandingRow[];
    const legacy = rows[0]?.parkOpsConfigJson;
    if (!legacy) return;

    let document: string;
    try {
      document = JSON.stringify(normalizeParkOpsConfig(JSON.parse(legacy)));
    } catch (error) {
      throw new Error(`PARK_OPS_VISUAL_IMPORT_FAILED: ${String(error)}`);
    }
    const checksum = createHash('sha256').update(document, 'utf8').digest('hex');
    await queryRunner.query(
      `INSERT INTO runtime_config_documents
       (config_key, schema_version, revision, document, document_sha256, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [PARK_OPS_VISUAL_CONFIG_KEY, PARK_OPS_VISUAL_SCHEMA_VERSION, document, checksum],
    );
    await queryRunner.query(
      `INSERT INTO runtime_config_revisions
       (config_key, schema_version, revision, document, document_sha256, actor, source, created_at)
       VALUES (?, ?, 1, ?, ?, 'migration', 'legacy-sqlite:system_branding_v2.parkOpsConfigJson', CURRENT_TIMESTAMP)`,
      [PARK_OPS_VISUAL_CONFIG_KEY, PARK_OPS_VISUAL_SCHEMA_VERSION, document, checksum],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [PARK_OPS_VISUAL_CONFIG_KEY],
    );
    if (rows.length) {
      throw new Error(
        'PARK_OPS_VISUAL_ROLLBACK_REQUIRES_ARCHIVE: authoritative configuration exists',
      );
    }
  }
}
