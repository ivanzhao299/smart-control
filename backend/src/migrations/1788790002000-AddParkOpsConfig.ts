import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddParkOpsConfig1788790002000 implements MigrationInterface {
  name = 'AddParkOpsConfig1788790002000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns: Array<{ name: string }> = await queryRunner.query(`PRAGMA table_info("system_branding_v2")`);
    if (!columns.some(column => column.name === 'parkOpsConfigJson')) {
      await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "parkOpsConfigJson" text`);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const columns: Array<{ name: string }> = await queryRunner.query(`PRAGMA table_info("system_branding_v2")`);
    if (columns.some(column => column.name === 'parkOpsConfigJson')) {
      await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "parkOpsConfigJson"`);
    }
  }
}
