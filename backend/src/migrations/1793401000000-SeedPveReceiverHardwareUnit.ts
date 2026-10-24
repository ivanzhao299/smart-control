import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-23：把 PVE 推流主机收进硬件清单 (hardware_units)。
 *
 * 之前只写进 devices 表（category='system'），硬件明细页读的是 hardware_units，
 * 两张表不互通，导致 PVE 在清单里看不到、也无法改 IP/端口。
 *
 * 这里归为 led-player（LED 播控主机），base URL 存在 addressing JSON：
 *   { "url": "http://192.168.77.10:8080", "note": "勇电bin receiver, block组播" }
 * 幂等：按 code 唯一 ON CONFLICT DO NOTHING。
 */
export class SeedPveReceiverHardwareUnit1793401000000 implements MigrationInterface {
  name = 'SeedPveReceiverHardwareUnit1793401000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const addressing = JSON.stringify({
      url: 'http://192.168.77.10:8080',
      note: '勇电bin receiver, block组播 224.1.1.1:1508',
    });
    const cols = ['code', 'name', 'category', 'vendor', 'model', 'ip', 'addressing', 'status', 'enabled']
      .map((c) => `"${c}"`).join(',');
    const vals = [
      "'PVE-REC-01'",
      "'PVE 推流主机（勇电bin receiver）'",
      "'led-player'",
      "'PVE'",
      "'VM + USB 网卡'",
      "'192.168.77.10'",
      `'${addressing.replace(/'/g, "''")}'`,
      "'offline'",
      pg ? 'true' : '1',
    ].join(',');
    await q.query(
      pg
        ? `INSERT INTO "hardware_units" (${cols}) VALUES (${vals}) ON CONFLICT ("code") DO NOTHING`
        : `INSERT OR IGNORE INTO "hardware_units" (${cols}) VALUES (${vals})`,
    );
  }

  async down(): Promise<void> {
    // 纯增量：不删，保留管理员调整结果。
  }
}
