import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 将园区智慧运营总览作为内置网页媒体加入 Smart Control 媒体库。
 * 手机端可与现有动态欢迎页一样直接推送到 LED 播放通道。
 */
export class SeedParkOpsDashboard1788790000000 implements MigrationInterface {
  name = 'SeedParkOpsDashboard1788790000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const name = '金湖科创产业园·智慧运营总览(DEMO)';
    const exists = await queryRunner.query(
      `SELECT id FROM "media_assets" WHERE "originalName" = ? LIMIT 1`,
      [name],
    );
    if (Array.isArray(exists) && exists.length > 0) return;

    await queryRunner.query(
      `INSERT INTO "media_assets"
      ("originalName", "safeName", "path", "kind", "sourceUrl", "mimeType", "sizeBytes", "durationSec", "resolution", "remark", "uploader", "last_played_at")
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        name,
        'webpage',
        '',
        'webpage',
        'http://localhost:5173/control/park-ops/index.html',
        'text/html',
        0,
        null,
        '3612x1462',
        '园区综合态势/企业经营/安全消防/人车管理/视频监控五页演示大屏；当前为模拟数据，摄像头接口预留',
        'system',
        null,
      ],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "media_assets" WHERE "originalName" = ? AND "kind" = 'webpage'`,
      ['金湖科创产业园·智慧运营总览(DEMO)'],
    );
  }
}
