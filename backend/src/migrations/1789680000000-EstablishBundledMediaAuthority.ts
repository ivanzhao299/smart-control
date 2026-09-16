import { MigrationInterface, QueryRunner } from 'typeorm';

interface WebpageAsset {
  key: string;
  originalName: string;
  sourceUrl: string;
  resolution: string | null;
  remark: string;
}

const WEBPAGES: WebpageAsset[] = [
  {
    key: 'web.park-operations-dashboard',
    originalName: '金湖科创产业园·智慧运营总览(DEMO)',
    sourceUrl: 'http://localhost:5173/control/park-ops/index.html',
    resolution: '3612x1462',
    remark:
      '园区综合态势/企业经营/安全消防/人车管理/视频监控五页演示大屏；当前为模拟数据，摄像头接口预留',
  },
  {
    key: 'web.welcome-dynamic',
    originalName: '金湖欢迎页·动态(称谓可编辑)',
    sourceUrl: 'http://localhost:5173/control/welcome/index.html',
    resolution: null,
    remark: '推到大屏/投影即显示; 嘉宾称谓在 后台→系统品牌→欢迎页嘉宾称谓 编辑, 约 20s 自动生效',
  },
];

/**
 * Give bundled media stable identities and move the last startup data repair
 * into the versioned migration ledger. File bytes are reconciled separately by
 * the deployment controller while the database/media recovery fence is active.
 */
export class EstablishBundledMediaAuthority1789680000000 implements MigrationInterface {
  name = 'EstablishBundledMediaAuthority1789680000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE media_assets ADD COLUMN system_key varchar(100)`);
    await q.query(`ALTER TABLE media_assets ADD COLUMN artifact_sha256 varchar(64)`);
    await q.query(
      `CREATE UNIQUE INDEX ux_media_assets_system_key ON media_assets(system_key)
       WHERE system_key IS NOT NULL`,
    );

    // Exact one-time metadata repair; application startup is read-only afterward.
    await q.query(`UPDATE media_assets SET mimeType = 'video/mp4' WHERE mimeType = 'video/x-m4v'`);

    for (const asset of WEBPAGES) await this.establishWebpage(q, asset);
  }

  async down(): Promise<void> {
    throw new Error('BUNDLED_MEDIA_AUTHORITY_ROLLBACK_REQUIRES_ARCHIVE');
  }

  private async establishWebpage(q: QueryRunner, asset: WebpageAsset): Promise<void> {
    const rows = (await q.query(
      `SELECT id, kind, sourceUrl, path, visibility, uploader
       FROM media_assets
       WHERE owner_user_id IS NULL AND source = 'system' AND originalName = ?`,
      [asset.originalName],
    )) as Array<Record<string, unknown>>;
    if (rows.length > 1) throw new Error(`BUNDLED_MEDIA_DUPLICATE: ${asset.key}`);

    if (!rows.length) {
      await q.query(
        `INSERT INTO media_assets
         (owner_user_id, visibility, source, system_key, artifact_sha256,
          originalName, safeName, path, sourcePath, processingStatus, processingError,
          thumbPath, kind, sourceUrl, mimeType, sizeBytes, durationSec, resolution,
          remark, uploader, pageCount, docPdfPath, last_played_at, created_at, updated_at)
         VALUES
         (NULL, 'shared', 'system', ?, NULL, ?, 'webpage', '', NULL, 'ready', NULL,
          NULL, 'webpage', ?, 'text/html', 0, NULL, ?, ?, 'system', NULL, NULL, NULL,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [asset.key, asset.originalName, asset.sourceUrl, asset.resolution, asset.remark],
      );
      return;
    }

    const row = rows[0];
    if (
      row.kind !== 'webpage' ||
      row.sourceUrl !== asset.sourceUrl ||
      row.path !== '' ||
      row.visibility !== 'shared' ||
      row.uploader !== 'system'
    ) {
      throw new Error(`BUNDLED_MEDIA_CONFLICT: ${asset.key}`);
    }
    await q.query(`UPDATE media_assets SET system_key = ? WHERE id = ? AND system_key IS NULL`, [
      asset.key,
      row.id,
    ]);
  }
}
