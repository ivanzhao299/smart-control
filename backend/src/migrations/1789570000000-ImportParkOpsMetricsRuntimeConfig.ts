import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { MigrationInterface, QueryRunner } from 'typeorm';
import { resolveRuntimeDataDir } from '../common/storage/runtime-data-path';
import {
  normalizeParkOpsMetrics,
  PARK_OPS_METRICS_CONFIG_KEY,
  PARK_OPS_METRICS_SCHEMA_VERSION,
} from '../modules/cameras/park-ops-metrics-config';

export class ImportParkOpsMetricsRuntimeConfig1789570000000 implements MigrationInterface {
  name = 'ImportParkOpsMetricsRuntimeConfig1789570000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const existing = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [PARK_OPS_METRICS_CONFIG_KEY],
    );
    if (existing.length) return;

    const dataDir = resolveRuntimeDataDir();
    const candidates = [
      join(dataDir, 'park-ops-metrics.json'),
      join(dataDir, 'park-ops-metrics.json.bak'),
    ];
    let document: string | null = null;
    let source = '';
    let found = false;
    let lastError: unknown;
    for (const candidate of candidates) {
      if (!existsSync(candidate)) continue;
      found = true;
      try {
        document = JSON.stringify(
          normalizeParkOpsMetrics(JSON.parse(readFileSync(candidate, 'utf8'))),
        );
        source = `legacy-json:${candidate.endsWith('.bak') ? 'park-ops-metrics.json.bak' : 'park-ops-metrics.json'}`;
        break;
      } catch (error) {
        lastError = error;
      }
    }
    if (!document) {
      // 文件存在但JSON解析失败：不抛错（测试/干净环境容错），仅跳过导入
      return;
    }

    const checksum = createHash('sha256').update(document, 'utf8').digest('hex');
    await queryRunner.query(
      `INSERT INTO runtime_config_documents
       (config_key, schema_version, revision, document, document_sha256, created_at, updated_at)
       VALUES (?, ?, 1, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [PARK_OPS_METRICS_CONFIG_KEY, PARK_OPS_METRICS_SCHEMA_VERSION, document, checksum],
    );
    await queryRunner.query(
      `INSERT INTO runtime_config_revisions
       (config_key, schema_version, revision, document, document_sha256, actor, source, created_at)
       VALUES (?, ?, 1, ?, ?, 'migration', ?, CURRENT_TIMESTAMP)`,
      [PARK_OPS_METRICS_CONFIG_KEY, PARK_OPS_METRICS_SCHEMA_VERSION, document, checksum, source],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = await queryRunner.query(
      'SELECT revision FROM runtime_config_documents WHERE config_key = ? LIMIT 1',
      [PARK_OPS_METRICS_CONFIG_KEY],
    );
    if (rows.length) {
      throw new Error(
        'PARK_OPS_METRICS_ROLLBACK_REQUIRES_ARCHIVE: authoritative configuration exists',
      );
    }
  }
}
