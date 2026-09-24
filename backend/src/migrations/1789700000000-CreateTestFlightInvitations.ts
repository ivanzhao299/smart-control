import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TestFlight 内部测试员邀请记录表。
 *
 * 后台「iOS 测试」页用它做幂等 / 列表 / 状态 / 重发。纯新增表, 不触碰任何既有表,
 * 因此即便该功能未配置苹果密钥, 也不影响既有运营/控制接口。
 */
export class CreateTestFlightInvitations1789700000000 implements MigrationInterface {
  name = 'CreateTestFlightInvitations1789700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "testflight_invitation_v1" (
         "id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,
         "apple_invitation_id" varchar(64),
         "email" varchar(254) NOT NULL,
         "first_name" varchar(80) NOT NULL,
         "last_name" varchar(80) NOT NULL,
         "role" varchar(32) NOT NULL DEFAULT ('MARKETING'),
         "app_id" varchar(20) NOT NULL,
         "status" varchar(20) NOT NULL DEFAULT ('PENDING'),
         "expiration_date" datetime,
         "last_error" text,
         "invited_by" varchar(120),
         "invited_at" datetime,
         "created_at" datetime NOT NULL DEFAULT (datetime('now')),
         "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_testflight_invitation_email"
       ON "testflight_invitation_v1" ("email")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS "IDX_testflight_invitation_email"');
    await queryRunner.query('DROP TABLE IF EXISTS "testflight_invitation_v1"');
  }
}
