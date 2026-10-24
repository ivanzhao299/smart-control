import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-24：修正 PVE receiver URL 配置。
 *
 * GK9000 (192.168.77.54) 与 PVE (192.168.77.10) 同内网，直接访问。
 * 确保 hardware_units 表 PVE-REC-01 的 addressing.url 正确。
 */
export class FixPveReceiverUrl1793700000100 implements MigrationInterface {
  name = 'FixPveReceiverUrl1793700000100';

  async up(q: QueryRunner): Promise<void> {
    const addressing = JSON.stringify({
      url: 'http://192.168.77.10:8080',
      note: '勇电bin receiver, block组播 224.1.1.1:1508',
    });
    const pg = q.connection.options.type === 'postgres';

    if (pg) {
      await q.query(`
        INSERT INTO "hardware_units" (code, name, category, vendor, model, ip, addressing, status, enabled)
        VALUES ('PVE-REC-01', 'PVE 推流主机（勇电bin receiver）', 'led-player', 'PVE', 'VM + USB 网卡', '192.168.77.10', '${addressing.replace(/'/g, "''")}', 'online', true)
        ON CONFLICT (code) DO UPDATE SET
          addressing = EXCLUDED.addressing,
          ip = EXCLUDED.ip;
      `);
    } else {
      await q.query(`
        INSERT OR REPLACE INTO hardware_units (code, name, category, vendor, model, ip, addressing, status, enabled)
        VALUES ('PVE-REC-01', 'PVE 推流主机（勇电bin receiver）', 'led-player', 'PVE', 'VM + USB 网卡', '192.168.77.10', '${addressing.replace(/'/g, "''")}', 'online', 1);
      `);
    }
  }

  async down(): Promise<void> {
    // 纯配置修正，不回滚
  }
}
