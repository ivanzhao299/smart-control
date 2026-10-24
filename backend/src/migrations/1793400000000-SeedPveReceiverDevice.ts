import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-22：把 PVE 推流主机作为设备入库，便于在硬件明细里改 IP/端口、做探活。
 *
 * - name:    PVE 推流主机（勇电 bin receiver）
 * - category: system（基础设施类，非灯/音响/空调等物理子系统）
 * - adapter: pve-receiver（LedProgramService 按此 adapter 查设备行读 base URL）
 * - ip:      192.168.77.10（PVE 静态 IP，用户已确认）
 * - address: http://192.168.77.10:8080（PVE 上跑的 bin receiver 监听端口）
 *
 * 幂等：按 name 唯一索引 ON CONFLICT DO NOTHING。改 IP 后由管理员在硬件明细页编辑。
 */
export class SeedPveReceiverDevice1793400000000 implements MigrationInterface {
  name = 'SeedPveReceiverDevice1793400000000';

  private esc(v: string): string {
    return `'${v.replace(/'/g, "''")}'`;
  }

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const bool = (v: boolean) => (pg ? (v ? 'true' : 'false') : v ? '1' : '0');
    const cols = [
      'name', 'category', 'protocol', 'adapter',
      'ip', 'address', 'enabled', 'status',
    ].map((c) => `"${c}"`).join(',');
    const vals = [
      this.esc('PVE 推流主机'),
      this.esc('system'),
      this.esc('http'),
      this.esc('pve-receiver'),
      this.esc('192.168.77.10'),
      this.esc('http://192.168.77.10:8080'),
      bool(true),
      this.esc('offline'),
    ].join(',');
    await q.query(
      pg
        ? `INSERT INTO "devices" (${cols}) VALUES (${vals}) ON CONFLICT ("name") DO NOTHING`
        : `INSERT OR IGNORE INTO "devices" (${cols}) VALUES (${vals})`,
    );
  }

  async down(): Promise<void> {
    // 纯增量：不删设备行，保留管理员调整结果。
  }
}
