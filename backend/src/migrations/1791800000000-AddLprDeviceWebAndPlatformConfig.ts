import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add LPR camera web-admin credentials + platform config table (2026-10-13).
 *
 * 纯增量、幂等：
 *  - lpr_device 新增 web_user / web_password / web_url（相机 web 后台登录信息）；
 *  - 新建 lpr_platform_config 单行表（id=1，标准平台接入参数）。
 * 不改动任何既有数据。
 */
export class AddLprDeviceWebAndPlatformConfig1791800000000 implements MigrationInterface {
  name = 'AddLprDeviceWebAndPlatformConfig1791800000000';

  async up(q: QueryRunner): Promise<void> {
    const cols = (await q.query(`PRAGMA table_info(lpr_device)`)) as Array<{ name: string }>;
    const names = new Set(cols.map((c) => c.name));
    if (!names.has('web_user')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN web_user VARCHAR(64) DEFAULT 'admin'`);
    }
    if (!names.has('web_password')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN web_password VARCHAR(128) DEFAULT 'admin'`);
    }
    if (!names.has('web_url')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN web_url VARCHAR(255)`);
    }

    await q.query(`CREATE TABLE IF NOT EXISTS lpr_platform_config (
      id INTEGER PRIMARY KEY,
      host VARCHAR(128) NOT NULL,
      http_port INTEGER NOT NULL DEFAULT 80,
      https_port INTEGER NOT NULL DEFAULT 443,
      comet_path VARCHAR(128) NOT NULL DEFAULT '/api/lpr/comet',
      plate_path VARCHAR(128) NOT NULL DEFAULT '/api/lpr/plate',
      gio_path VARCHAR(128) NOT NULL DEFAULT '/api/lpr/gio',
      serial_path VARCHAR(128) NOT NULL DEFAULT '/api/lpr/serial',
      note TEXT,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);
    // 单行默认配置（已存在则忽略）
    await q.query(`INSERT OR IGNORE INTO lpr_platform_config
      (id, host, http_port, https_port, comet_path, plate_path, gio_path, serial_path)
      VALUES (1, 'erp.cnjinhu.com', 80, 443, '/api/lpr/comet', '/api/lpr/plate', '/api/lpr/gio', '/api/lpr/serial')`);
  }

  async down(): Promise<void> {
    // SQLite 无法 DROP COLUMN（旧版本），且为纯增量功能，不回滚。
  }
}
