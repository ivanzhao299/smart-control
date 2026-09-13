import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * system_branding_v2 加欢迎页编辑器三字段 (业主 2026-07-28: "把欢迎页内容编辑
 * 放到前端, 可以更换底图作为模板、可以编辑文字, 保存后立即生效"):
 *   welcomeTitle      主标题 (空=默认"热烈欢迎")
 *   welcomeTagline    底部标语 (空=默认"智慧展厅 · 数字展贸 · 科创未来")
 *   welcomeBgMediaId  底图媒体 id (空=内置"鎏金夜湖"程序化底图)
 * 幂等: 先查 PRAGMA table_info, 列已存在就跳过 (兼容 service 自愈先行加列的情况)。
 */
export class AddWelcomeEditor1785150000000 implements MigrationInterface {
    name = 'AddWelcomeEditor1785150000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const cols: Array<{ name: string }> = await queryRunner.query(`PRAGMA table_info("system_branding_v2")`);
        const has = (n: string) => cols.some((c) => c.name === n);
        if (!has('welcomeTitle')) {
            await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeTitle" varchar(32)`);
        }
        if (!has('welcomeTagline')) {
            await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeTagline" varchar(64)`);
        }
        if (!has('welcomeBgMediaId')) {
            await queryRunner.query(`ALTER TABLE "system_branding_v2" ADD COLUMN "welcomeBgMediaId" integer`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeBgMediaId"`);
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeTagline"`);
        await queryRunner.query(`ALTER TABLE "system_branding_v2" DROP COLUMN "welcomeTitle"`);
    }
}
