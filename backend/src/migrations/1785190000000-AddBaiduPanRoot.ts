import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * baidu_pan_auth 加 rootPath — 网盘可见根目录 (2026-07-30 业主隐私收紧:
 * "别人登录之后也能看见我的百度网盘内容吗" → 两层收紧之二)。
 * 设置后浏览/下载全部钳制在该目录内; null = 全盘可见 (老行为)。
 */
export class AddBaiduPanRoot1785190000000 implements MigrationInterface {
    name = 'AddBaiduPanRoot1785190000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 幂等: 后端启动自愈可能先把列补上了 (watcher 部署不跑 migrations 的历史窗口)
        const cols = await queryRunner.query(`PRAGMA table_info("baidu_pan_auth")`) as Array<{ name: string }>;
        if (!cols.some((c) => c.name === 'rootPath')) {
            await queryRunner.query(`ALTER TABLE "baidu_pan_auth" ADD COLUMN "rootPath" varchar(256)`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "baidu_pan_auth" DROP COLUMN "rootPath"`);
    }
}
