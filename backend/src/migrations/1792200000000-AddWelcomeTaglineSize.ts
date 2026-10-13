import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * system_branding_v2 加 welcomeTaglineSize — 欢迎页底部标语字号
 * (设计稿 px, 业主 2026-10-13: 最下方一行文字也可数字调整, 做法同主标题/嘉宾行)。
 * NULL = 内置默认 48 (渲染页 fitTagline 兜底); 大屏欢迎页轮询读取, 改完实时生效。
 */
export class AddWelcomeTaglineSize1792200000000 implements MigrationInterface {
    name = 'AddWelcomeTaglineSize1792200000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeTaglineSize" integer`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeTaglineSize"`);
    }
}
