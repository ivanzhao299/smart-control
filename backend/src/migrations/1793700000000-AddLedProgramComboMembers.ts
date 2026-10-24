import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-24：LED 节目表加 combo_members 列。
 *
 * - combo_members: 组合节目成员BIN ID列表（JSON数组字符串）
 *   template_type='combo'时生效，存储如 [16,19,22]
 */
export class AddLedProgramComboMembers1793700000000 implements MigrationInterface {
  name = 'AddLedProgramComboMembers1793700000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "led_program" ADD COLUMN "combo_members" TEXT NULL`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "led_program" DROP COLUMN "combo_members"`);
  }
}
