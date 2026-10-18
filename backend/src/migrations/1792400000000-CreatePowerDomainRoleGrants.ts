import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 角色 × 电源域 授权表 (2026-10-18, 第十六轮「后台可配的分域授权」).
 *
 * 纯增量、幂等 (CREATE TABLE/INDEX IF NOT EXISTS, 种子 ON CONFLICT / INSERT OR IGNORE),
 * 双方言 (生产 PostgreSQL / 本地 SQLite)。
 *
 * 把原先写死在 common/auth/rbac.ts 的角色×域矩阵搬进数据库, 后台可按三态配置：
 *    不可见(无记录) / 仅可见(can_read) / 可操作(can_write, 隐含可读)。
 *
 * 种子当前内置矩阵（与 rbac.ts 完全一致）：
 *    config   → park 读写（运营配置员管园区 4G 自动开关）
 *    operator → hall 读写（展厅操作员管展厅播控/电源）
 *    viewer   → hall 只读（观察者只看展厅）
 * admin / hardware 不入库 —— 代码锁死全域（含未来新域），防止误配自锁、全场断电。
 *
 * 通用化：role 是普通字符串列，未来新增角色后后台矩阵会自动出现该行，无需改库表。
 */
export class CreatePowerDomainRoleGrants1792400000000 implements MigrationInterface {
  name = 'CreatePowerDomainRoleGrants1792400000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";
    const bool = (v: boolean) => (pg ? (v ? 'true' : 'false') : v ? '1' : '0');

    await q.query(`CREATE TABLE IF NOT EXISTS "power_domain_role_grant" (
      "id" ${pg ? 'SERIAL' : 'integer'} PRIMARY KEY,
      "role" varchar(32) NOT NULL,
      "domain_code" varchar(32) NOT NULL,
      "can_read" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "can_write" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_power_domain_role_grant"
       ON "power_domain_role_grant" ("role","domain_code")`,
    );

    // 种子：与 rbac.ts 内置矩阵一致。幂等（唯一键冲突跳过，不覆盖后台已做的调整）。
    const seeds: Array<[string, string, boolean, boolean]> = [
      ['config', 'park', true, true],
      ['operator', 'hall', true, true],
      ['viewer', 'hall', true, false],
    ];
    for (const [role, domainCode, canRead, canWrite] of seeds) {
      if (pg) {
        await q.query(
          `INSERT INTO "power_domain_role_grant" ("role","domain_code","can_read","can_write")
           VALUES ('${role}','${domainCode}',${bool(canRead)},${bool(canWrite)})
           ON CONFLICT ("role","domain_code") DO NOTHING`,
        );
      } else {
        await q.query(
          `INSERT OR IGNORE INTO "power_domain_role_grant" ("role","domain_code","can_read","can_write")
           VALUES ('${role}','${domainCode}',${bool(canRead)},${bool(canWrite)})`,
        );
      }
    }
  }

  async down(): Promise<void> {
    // 纯增量授权表；不回滚（保留授权历史）。
  }
}
