import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add LPR software-commanded gate state (2026-10-13).
 *
 * GPIO 开关量道闸无真实杆位反馈（相机不推 barr_gate_status_notify），
 * 以最近一次远程开/关指令作为"指令态"展示。
 * 纯增量、幂等：
 *  - lpr_device 新增 commanded_gate（1=开闸 / 0=关闸 / NULL=从未操作）；
 *  - lpr_device 新增 commanded_gate_at（最近一次远程开/关指令时间）。
 * 不改动任何既有数据。
 */
export class AddLprCommandedGate1792100000000 implements MigrationInterface {
  name = 'AddLprCommandedGate1792100000000';

  async up(q: QueryRunner): Promise<void> {
    const cols = (await q.query(`PRAGMA table_info(lpr_device)`)) as Array<{ name: string }>;
    if (cols.length > 0 && !cols.some((c) => c.name === 'commanded_gate')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN commanded_gate INTEGER`);
    }
    if (cols.length > 0 && !cols.some((c) => c.name === 'commanded_gate_at')) {
      await q.query(`ALTER TABLE lpr_device ADD COLUMN commanded_gate_at DATETIME`);
    }
  }

  async down(): Promise<void> {
    // SQLite 无法 DROP COLUMN（旧版本），且为纯增量功能，不回滚。
  }
}
