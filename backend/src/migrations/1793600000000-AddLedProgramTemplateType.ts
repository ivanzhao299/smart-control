import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-24：LED 节目表加 template_type 列。
 *
 * - template_type: 模板类型 (custom/daily/spring/national/newyear/welcome/invest)
 *   custom = 手动编排，其他 = 内置自动模板生成
 * 默认值: 'custom'（所有已有记录都是手动编排）。
 */
export class AddLedProgramTemplateType1793600000000 implements MigrationInterface {
  name = 'AddLedProgramTemplateType1793600000000';

  async up(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "led_program" ADD COLUMN "template_type" VARCHAR(32) DEFAULT 'custom'`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "led_program" DROP COLUMN "template_type"`);
  }
}
