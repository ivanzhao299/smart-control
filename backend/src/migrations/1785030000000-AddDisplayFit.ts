import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * playback_channel 加 displayFit — 大屏/投影的画面铺放模式 (业主 2026-07-25:
 * "显示图片或视频时应该有多种选项, 铺满/保持比例/裁切, 默认铺满")。
 *   fill    = 铺满拉伸 (默认)
 *   contain = 保持比例 (不裁不变形, 比例不一致时留黑边)
 *   cover   = 裁切铺满 (等比放大裁掉超出部分)
 */
export class AddDisplayFit1785030000000 implements MigrationInterface {
    name = 'AddDisplayFit1785030000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "playback_channels" ADD COLUMN "displayFit" varchar(16) NOT NULL DEFAULT ('fill')`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "playback_channels" DROP COLUMN "displayFit"`);
    }
}
