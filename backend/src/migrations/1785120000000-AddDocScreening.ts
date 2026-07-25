import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * 文档投屏 (2026-07-25 业主): LED/投影支持 Word/PPT。
 * - media_assets.pageCount: 文档总页数 (放映守护用 PowerPoint/Word COM 回写, 最准)
 * - media_assets.docPdfPath: Word 转出的 PDF 相对路径 (kiosk 逐页渲染用; PPT 原生放映不需要)
 * - playback_channels.docPage: 当前页 (手机翻页条驱动, WS 广播, 守护轮询执行)
 * 表名注意: media_assets / playback_channels 均为复数 (2026-07-25 单数表名事故复盘)。
 */
export class AddDocScreening1785120000000 implements MigrationInterface {
    name = 'AddDocScreening1785120000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "pageCount" integer`);
        await queryRunner.query(`ALTER TABLE "media_assets" ADD COLUMN "docPdfPath" varchar(500)`);
        await queryRunner.query(`ALTER TABLE "playback_channels" ADD COLUMN "docPage" integer NOT NULL DEFAULT (1)`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "playback_channels" DROP COLUMN "docPage"`);
        await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "docPdfPath"`);
        await queryRunner.query(`ALTER TABLE "media_assets" DROP COLUMN "pageCount"`);
    }
}
