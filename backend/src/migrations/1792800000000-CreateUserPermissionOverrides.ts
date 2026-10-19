import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 用户级权限覆盖表（第二十一轮，RBAC 增强）：
 *
 * 在"角色 → 权限"之上增加"用户 → 权限"的个人例外层：
 *   - effect = 'grant'：在该用户角色权限之外额外开通；
 *   - effect = 'deny' ：临时关闭该用户角色本来拥有的权限点。
 *
 * 有效权限 = 角色权限 ∪ 用户 grant − 用户 deny。
 *   - admin 恒为全集，任何 deny 对 admin 不生效（运行时直接忽略，防自锁）；
 *   - 登录方向（can_front/can_back）仍由角色决定，不做个人覆盖；
 *   - 用户删除时，其个人覆盖经 ON DELETE CASCADE 连带清除（附属数据）。
 *
 * 纯增量、幂等（CREATE TABLE / INDEX IF NOT EXISTS）、双方言（生产 PostgreSQL /
 * 本地 SQLite）。down 不回滚（遵循 RBAC 纯增量约定，避免删库）。
 */
export class CreateUserPermissionOverrides1792800000000 implements MigrationInterface {
  name = 'CreateUserPermissionOverrides1792800000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";
    const serial = pg ? 'SERIAL' : 'integer';
    // PG 用 CHECK 限定 effect 取值；SQLite 由运行时 service 过滤（trigger 成本高）。
    const effectCheck = pg
      ? `,CONSTRAINT "ck_rbac_user_permission_effect" CHECK ("effect" IN ('grant','deny'))`
      : '';

    // ---------- 用户 × 权限点 覆盖表（唯一性由下方唯一索引保证，两端一致） ----------
    await q.query(`CREATE TABLE IF NOT EXISTS "rbac_user_permission" (
      "id" ${serial} PRIMARY KEY,
      "user_id" integer NOT NULL,
      "permission_code" varchar(64) NOT NULL,
      "effect" varchar(8) NOT NULL,
      "created_at" ${ts},
      "updated_at" ${ts},
      CONSTRAINT "fk_rbac_user_permission_user" FOREIGN KEY ("user_id")
        REFERENCES "users" ("id") ON DELETE CASCADE${effectCheck}
    )`);

    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_rbac_user_permission"
       ON "rbac_user_permission" ("user_id","permission_code")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_rbac_user_permission_user"
       ON "rbac_user_permission" ("user_id")`,
    );
  }

  async down(): Promise<void> {
    // 纯增量表；不回滚（保留用户个人覆盖，避免删库）。
  }
}
