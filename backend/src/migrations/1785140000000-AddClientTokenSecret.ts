import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * client_auth_v1 加 tokenSecret — 客户端令牌改签名制 (业主 2026-07-27:
 * "本地网络下 PWA 经常退出, 需要加固")。
 *
 * 老方案的会话表是**内存 Map**, 后端每次重启/部署全体 token 失效, 业主的
 * iPhone/平板就被打回登录页。改为 HMAC 签名令牌: 签名密钥持久化在这列,
 * 令牌自带有效期, 后端重启后照样验得过 —— 除非改密码 (密钥轮换全体失效)。
 */
export class AddClientTokenSecret1785140000000 implements MigrationInterface {
    name = 'AddClientTokenSecret1785140000000'

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 幂等: 后端启动自愈 (client-auth.service onModuleInit) 可能先把列补上了
        // (watcher 部署不跑 migrations 的历史窗口), 重复 ADD 会炸掉整个迁移
        const cols = await queryRunner.query(`PRAGMA table_info("client_auth_v1")`) as Array<{ name: string }>;
        if (!cols.some((c) => c.name === 'tokenSecret')) {
            await queryRunner.query(`ALTER TABLE "client_auth_v1" ADD COLUMN "tokenSecret" varchar(64)`);
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "client_auth_v1" DROP COLUMN "tokenSecret"`);
    }
}
