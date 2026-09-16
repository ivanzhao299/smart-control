import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * admin_auth_v1 加 tokenSecret — 后台令牌改签名制 (业主 2026-07-30:
 * "后台上传图标时提示登录已过期")。
 *
 * 根因与 #22 客户端被踢完全同款: admin session 是内存 Map, 每次部署重启后端
 * 全体 admin token 失效。当天连发十几个版本, 业主编辑一半就被踢。
 * 照客户端令牌签名制 (1785140000000) 原样搬过来: HMAC 签名 + 8h 有效期自带,
 * 重启存活; 改密码时 passwordChangedAt 更新让全体旧令牌失效, 语义不变。
 */
export class AddAdminTokenSecret1785180000000 implements MigrationInterface {
    name = 'AddAdminTokenSecret1785180000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 幂等：兼容历史版本曾提前补列的数据库；当前应用启动不执行 DDL。
        const cols = await queryRunner.query(`PRAGMA table_info("admin_auth_v1")`) as Array<{ name: string }>;
        if (!cols.some((c) => c.name === 'tokenSecret')) {
            await queryRunner.query(`ALTER TABLE "admin_auth_v1" ADD COLUMN "tokenSecret" varchar(64)`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "admin_auth_v1" DROP COLUMN "tokenSecret"`);
    }
}
