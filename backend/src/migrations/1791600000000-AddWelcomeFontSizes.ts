import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * system_branding_v2 加 welcomeTitleSize / welcomeGuestSize — 欢迎页主标题与
 * 嘉宾行字号 (设计稿 px, 业主 2026-10-09: 两行字号都可数字调整)。
 * NULL = 内置默认 (标题 180 / 嘉宾 96); 大屏欢迎页轮询读取, 改完实时生效。
 */
export class AddWelcomeFontSizes1791600000000 implements MigrationInterface {
    name = 'AddWelcomeFontSizes1791600000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeTitleSize" integer`);
        await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeGuestSize" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeGuestSize"`);
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeTitleSize"`);
    }
}
