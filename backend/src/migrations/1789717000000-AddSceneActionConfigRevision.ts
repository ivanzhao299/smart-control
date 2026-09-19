import { MigrationInterface, QueryRunner } from 'typeorm';
export class AddSceneActionConfigRevision1789717000000 implements MigrationInterface {
  name = 'AddSceneActionConfigRevision1789717000000';
  async up(q: QueryRunner) { const t = await q.getTable('scene_actions'); if (!t) throw new Error('scene_actions table is required'); if (!t.findColumnByName('config_revision')) await q.query('ALTER TABLE "scene_actions" ADD COLUMN "config_revision" integer NOT NULL DEFAULT 1'); }
  async down(q: QueryRunner) { const t = await q.getTable('scene_actions'); if (t?.findColumnByName('config_revision')) await q.query('ALTER TABLE "scene_actions" DROP COLUMN "config_revision"'); }
}
