import { MigrationInterface, QueryRunner } from 'typeorm';

/** Keep the independently released built-in dashboard shared on fresh installs too. */
export class ShareBuiltinParkDashboard1788790001000 implements MigrationInterface {
  name = 'ShareBuiltinParkDashboard1788790001000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(`UPDATE media_assets SET visibility = 'shared', source = 'system'
      WHERE owner_user_id IS NULL AND kind = 'webpage' AND uploader = 'system'
      AND originalName = ? AND sourceUrl = ?`, [
      '金湖科创产业园·智慧运营总览(DEMO)',
      'http://localhost:5173/control/park-ops/index.html',
    ]);
  }

  // Never delete a system presentation or guess its earlier visibility on rollback.
  async down(): Promise<void> {}
}
