import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-24：确保 led_program.combo_members 列存在。
 *
 * 之前 1793700000000 migration 可能在生产端记录为已执行但实际列没加上，
 * 这个 migration 用 PRAGMA 检查后补列。
 */
export class EnsureComboMembersColumn1793700000200 implements MigrationInterface {
  name = 'EnsureComboMembersColumn1793700000200';

  async up(q: QueryRunner): Promise<void> {
    const cols = await q.query("PRAGMA table_info(led_program)");
    const hasColumn = cols.some((c: any) => c.name === 'combo_members');
    if (!hasColumn) {
      await q.query('ALTER TABLE "led_program" ADD COLUMN "combo_members" TEXT NULL');
      console.log('✅ added combo_members column');
    } else {
      console.log('✅ combo_members column already exists');
    }
  }

  async down(q: QueryRunner): Promise<void> {
    // 不删列
  }
}
