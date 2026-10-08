import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 易微联 eWeLink 授权配置表 (2026-10-08)。
 * 单行表 (id=1): OAuth2.0 授权码模式的 AppID/AppSecret + token 两件套 + 区域/家庭。
 * 生产禁用 synchronize，必须经此显式迁移建表，否则授权/回调接口报 no such table。
 * 幂等: CREATE TABLE IF NOT EXISTS。
 */
export class AddEwelinkAuth1791500000000 implements MigrationInterface {
    name = 'AddEwelinkAuth1791500000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "ewelink_auth" (
            "id" integer PRIMARY KEY NOT NULL,
            "appId" varchar(64),
            "appSecret" varchar(128),
            "accessToken" text,
            "refreshToken" text,
            "atExpiresAt" bigint,
            "rtExpiresAt" bigint,
            "region" varchar(8),
            "currentFamilyId" varchar(64),
            "updatedAt" datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "ewelink_auth"`);
    }
}
