import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSceneConfigRevision1789716000000 implements MigrationInterface {
  name = 'AddSceneConfigRevision1789716000000';
  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scenes');
    if (!table) throw new Error('scenes table is required');
    if (!table.findColumnByName('config_revision')) {
      await queryRunner.query(`ALTER TABLE "scenes" ADD COLUMN "config_revision" integer NOT NULL DEFAULT 1`);
    }
  }
  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scenes');
    if (table?.findColumnByName('config_revision')) await queryRunner.query(`ALTER TABLE "scenes" DROP COLUMN "config_revision"`);
  }
}
