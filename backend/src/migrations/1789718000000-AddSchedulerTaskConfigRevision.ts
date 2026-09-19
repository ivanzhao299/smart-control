import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSchedulerTaskConfigRevision1789718000000 implements MigrationInterface {
  name = 'AddSchedulerTaskConfigRevision1789718000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduler_tasks');
    if (table && !table.findColumnByName('config_revision')) {
      await queryRunner.query('ALTER TABLE "scheduler_tasks" ADD COLUMN "config_revision" integer NOT NULL DEFAULT 1');
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const table = await queryRunner.getTable('scheduler_tasks');
    if (table?.findColumnByName('config_revision')) {
      await queryRunner.query('ALTER TABLE "scheduler_tasks" DROP COLUMN "config_revision"');
    }
  }
}
