import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * system_branding_v2 加 welcomeGuest — 欢迎页嘉宾称谓 (业主 2026-07-26:
 * "欢迎页上的文字比如某某领导这个字段可以进行编辑")。
 * 大屏欢迎页 (frontend/public/welcome/) 20s 轮询此字段, 后台改完实时变字。
 * 空/NULL 时欢迎页回退显示 "各位领导嘉宾"。
 */
export class AddWelcomeGuest1785130000000 implements MigrationInterface {
    name = 'AddWelcomeGuest1785130000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeGuest" varchar(64)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeGuest"`);
    }
}
