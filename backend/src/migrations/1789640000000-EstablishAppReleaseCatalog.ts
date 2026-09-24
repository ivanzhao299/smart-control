import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Make application release ownership explicit.
 *
 * Android artifact metadata is advanced only by the verified deployment
 * reconciler. Operators continue to own notes and rollout policy in this row.
 */
export class EstablishAppReleaseCatalog1789640000000 implements MigrationInterface {
  name = 'EstablishAppReleaseCatalog1789640000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE app_release_v1
       ADD COLUMN release_source varchar(16) NOT NULL DEFAULT ('manual')`,
    );
    await queryRunner.query('ALTER TABLE app_release_v1 ADD COLUMN artifact_commit varchar(40)');
    await queryRunner.query('ALTER TABLE app_release_v1 ADD COLUMN artifact_sha256 varchar(64)');
    await queryRunner.query('ALTER TABLE app_release_v1 ADD COLUMN artifact_size integer');
    await queryRunner.query('ALTER TABLE app_release_v1 ADD COLUMN artifact_built_at datetime');

    await queryRunner.query(
      `UPDATE app_release_v1
       SET release_source = 'bundled'
       WHERE platform = 'android'
         AND download_url = 'http://192.168.77.54:3200/api/app/android/download'`,
    );
    await queryRunner.query(
      `INSERT INTO app_release_v1
       (platform, versionCode, versionName, download_url, notes, force_update,
        min_supported_version_code, enabled, release_source, created_at, updated_at)
       SELECT 'android', 22, '1.1.14',
              'http://192.168.77.54:3200/api/app/android/download',
              'v1.1.14: 桌面图标换全透明底新版; 更新改为展厅本地服务器直接下载。\n注意: 本次为签名切换版, 需先卸载旧版再安装 (之后的版本可直接覆盖升级)。',
              0, 1, 1, 'bundled', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE NOT EXISTS (SELECT 1 FROM app_release_v1 WHERE platform = 'android')`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      'SELECT COUNT(*) AS count FROM app_release_v1',
    )) as Array<{ count: number }>;
    if (Number(count) > 0) {
      throw new Error(
        'APP_RELEASE_CATALOG_ROLLBACK_REQUIRES_ARCHIVE: authoritative release data exists',
      );
    }

    await queryRunner.query('ALTER TABLE app_release_v1 DROP COLUMN artifact_built_at');
    await queryRunner.query('ALTER TABLE app_release_v1 DROP COLUMN artifact_size');
    await queryRunner.query('ALTER TABLE app_release_v1 DROP COLUMN artifact_sha256');
    await queryRunner.query('ALTER TABLE app_release_v1 DROP COLUMN artifact_commit');
    await queryRunner.query('ALTER TABLE app_release_v1 DROP COLUMN release_source');
  }
}
