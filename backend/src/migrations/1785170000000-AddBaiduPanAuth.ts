import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 百度网盘授权配置表 (业主 2026-07-29: 在线曲库连百度网盘)。
 * 单行表 (id=1): AppKey/SecretKey + 设备码授权的 token 三件套。
 * 幂等: CREATE TABLE IF NOT EXISTS。
 */
export class AddBaiduPanAuth1785170000000 implements MigrationInterface {
    name = 'AddBaiduPanAuth1785170000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TABLE IF NOT EXISTS "baidu_pan_auth" (
            "id" integer PRIMARY KEY NOT NULL,
            "appKey" varchar(64),
            "secretKey" varchar(64),
            "deviceCode" varchar(128),
            "accessToken" text,
            "refreshToken" text,
            "expiresAt" datetime,
            "updatedAt" datetime NOT NULL DEFAULT (datetime('now'))
        )`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "baidu_pan_auth"`);
    }
}
