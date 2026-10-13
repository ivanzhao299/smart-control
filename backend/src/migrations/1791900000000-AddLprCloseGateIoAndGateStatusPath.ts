import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add LPR close-gate IO + gate-status push path (2026-10-13).
 *
 * 纯增量、幂等：
 *  - lpr_device 新增 close_gate_io（关闸/落杆 IO 编号, 可空; null=未配置远程关闸）；
 *  - lpr_platform_config 新增 gate_status_path（道闸状态推送路径）。
 * 不改动任何既有数据。
 */
export class AddLprCloseGateIoAndGateStatusPath1791900000000 implements MigrationInterface {
  name = 'AddLprCloseGateIoAndGateStatusPath1791900000000';

  async up(q: QueryRunner): Promise<void> {
    const devCols = (await q.query(`PRAGMA table_info(lpr_device)`)) as Array<{ name: string }>;
    if (!devCols.some((c) => c.name === 'close_gate_io')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN close_gate_io INTEGER`);
    }

    const cfgCols = (await q.query(`PRAGMA table_info(lpr_platform_config)`)) as Array<{ name: string }>;
    if (cfgCols.length > 0 && !cfgCols.some((c) => c.name === 'gate_status_path')) {
      await q.query(
        `ALTER TABLE lpr_platform_config ADD COLUMN gate_status_path VARCHAR(128) NOT NULL DEFAULT '/api/lpr/gate-status'`,
      );
    }
  }

  async down(): Promise<void> {
    // SQLite 无法 DROP COLUMN（旧版本），且为纯增量功能，不回滚。
  }
}
