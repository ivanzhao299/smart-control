import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Additive migration (2026-09-14): 欢迎页"来访者拍照上墙"照片列。
 *
 * - 只在 system_branding_v2(单行 id=1) 增加一个可空整数列 welcomePhotoMediaId,
 *   指向 media_assets.id; NULL = 未上传, 欢迎页保持默认欢迎语布局。
 * - 幂等：兼容曾在历史版本中提前加列的数据库；当前应用启动不执行 DDL，
 *   列已存在时这里不得重复 ADD 把迁移打挂。
 * - 纯新增列, 不动任何旧数据, 可安全回滚 (仅删本列)。
 */
export class AddWelcomePhoto1789300000000 implements MigrationInterface {
  name = 'AddWelcomePhoto1789300000000';

  async up(q: QueryRunner): Promise<void> {
    const cols = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists = Array.isArray(cols) && cols.some((c: { name?: string }) => c?.name === 'welcomePhotoMediaId');
    if (!exists) {
      await q.addColumn(
        'system_branding_v2',
        new TableColumn({ name: 'welcomePhotoMediaId', type: 'integer', isNullable: true }),
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const cols = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists = Array.isArray(cols) && cols.some((c: { name?: string }) => c?.name === 'welcomePhotoMediaId');
    if (exists) {
      await q.dropColumn('system_branding_v2', 'welcomePhotoMediaId');
    }
  }
}
