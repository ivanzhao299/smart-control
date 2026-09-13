import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * playback_channel 加 docZoom — 文档投屏画面缩放百分比 (业主 2026-07-29:
 * "PPT 放映页面放大未全屏, 要补全屏/放大缩小控制")。
 * 100=铺满目标屏 / >100 放大 / <100 缩小; PPT 原生放映窗口与 kiosk PDF 都吃。
 * 幂等: PRAGMA 查列, 已存在跳过。
 */
export class AddDocZoom1785160000000 implements MigrationInterface {
    name = 'AddDocZoom1785160000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        const cols: Array<{ name: string }> = await queryRunner.query(`PRAGMA table_info("playback_channels")`);
        if (!cols.some((c) => c.name === 'docZoom')) {
            await queryRunner.query(`ALTER TABLE "playback_channels" ADD COLUMN "docZoom" integer NOT NULL DEFAULT 100`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "playback_channels" DROP COLUMN "docZoom"`);
    }
}
