import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddMediaProcessing1785190000000 implements MigrationInterface {
  name = 'AddMediaProcessing1785190000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const columns = await queryRunner.query(`PRAGMA table_info("media_assets")`) as Array<{ name: string }>;
    const names = new Set(columns.map((column) => column.name));
    if (!names.has('sourcePath')) await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "sourcePath" varchar(500)`);
    if (!names.has('processingStatus')) await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "processingStatus" varchar(16) NOT NULL DEFAULT ('ready')`);
    if (!names.has('processingError')) await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "processingError" varchar(1000)`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "processingError"`);
    await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "processingStatus"`);
    await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "sourcePath"`);
  }
}
