import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHardwareConfigRevision1789715000000 implements MigrationInterface {
  name = 'AddHardwareConfigRevision1789715000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('hardware_units');
    if (!table) throw new Error('hardware_units table is required');
    if (table.findColumnByName('config_revision')) return;
    await queryRunner.query(
      `ALTER TABLE "hardware_units" ADD COLUMN "config_revision" integer NOT NULL DEFAULT 1`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('hardware_units');
    if (!table?.findColumnByName('config_revision')) return;
    await queryRunner.query(`ALTER TABLE "hardware_units" DROP COLUMN "config_revision"`);
  }
}
