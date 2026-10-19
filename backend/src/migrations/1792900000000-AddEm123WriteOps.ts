import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * em123 水电二/三期写操作数据层 (2026-10-19):
 *
 * 1. 新建 em123_write_log 写操作审计流水表 (PG/SQLite 双方言, 幂等):
 *    记录改名/档案/现金录入/退费/减免/拉合闸/校时/多费率等全部写操作,
 *    含金额、前后余额、原因、前后值快照、平台返回、操作人, 供资金对账与控制追溯。
 *
 * 2. 预置「财务」(finance) 自定义角色:
 *    is_builtin=0/is_locked=0、仅可登录前台; 授权 energy:view/detail/export(只读+导出)
 *    + energy:recharge(现金/补量录入) + energy:refund(退费/减免);
 *    不给 energy:rename(改名/档案归物业)、不给 energy:control(高危, 仅 admin)。
 *
 * 3. 给既有「物业」(property) 角色补授 energy:rename(住房/业主改名、电表档案维护)。
 *
 * 4 个新权限点 (energy:rename/recharge/refund/control) 由 PermissionService.syncCatalog
 * 启动时按 permission-catalog 投影到 rbac_permission, 本迁移不重复 INSERT。
 *
 * 纯增量、幂等 (CREATE TABLE / INDEX IF NOT EXISTS, INSERT OR IGNORE / ON CONFLICT DO NOTHING)。
 */
export class AddEm123WriteOps1792900000000 implements MigrationInterface {
  name = 'AddEm123WriteOps1792900000000';

  /** SQL 字符串字面量转义。 */
  private esc(v: string | null | undefined): string {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const bool = (v: boolean) => (pg ? (v ? 'true' : 'false') : v ? '1' : '0');
    const dbl = pg ? 'double precision' : 'double';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";
    const serial = pg ? 'SERIAL' : 'integer';

    // 1. 写操作审计流水表
    await q.query(`CREATE TABLE IF NOT EXISTS "em123_write_log" (
      "id" ${serial} PRIMARY KEY,
      "biz_type" varchar(24) NOT NULL,
      "meter_type" varchar(2),
      "meter_no" varchar(64),
      "meter_id" varchar(32),
      "house_id" varchar(32),
      "house_name" varchar(128),
      "user_name" varchar(64),
      "amount" ${dbl} NOT NULL DEFAULT 0,
      "before_balance" ${dbl},
      "after_balance" ${dbl},
      "reason" varchar(256),
      "payload_before" text,
      "payload_after" text,
      "platform_code" integer,
      "platform_msg" varchar(256),
      "status" varchar(8) NOT NULL DEFAULT 'success',
      "operator_id" integer,
      "operator_name" varchar(64),
      "operator_role" varchar(32),
      "created_at" ${ts}
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_em123_write_log_created" ON "em123_write_log" ("created_at")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_em123_write_log_type_meter" ON "em123_write_log" ("biz_type", "meter_no")`,
    );

    // 2. 财务（finance）自定义角色（前台 / 启用 / 非内置 / 非锁定）
    const roleCols = [
      'code', 'name', 'description', 'is_builtin', 'is_locked',
      'can_front', 'can_back', 'enabled', 'sort_order',
    ].map((c) => `"${c}"`).join(',');
    const roleVals = [
      this.esc('finance'),
      this.esc('财务'),
      this.esc('财务/收银：PWA 前台水电查询导出、现金/补量录入、退费/减免（二次确认+留痕+按日对账）；不可改名/档案、不可拉合闸。'),
      bool(false),
      bool(false),
      bool(true),  // can_front
      bool(false), // can_back
      bool(true),  // enabled
      '110',
    ].join(',');
    await q.query(
      pg
        ? `INSERT INTO "rbac_role" (${roleCols}) VALUES (${roleVals}) ON CONFLICT ("code") DO NOTHING`
        : `INSERT OR IGNORE INTO "rbac_role" (${roleCols}) VALUES (${roleVals})`,
    );

    // 3. 财务角色授权：只读+导出 + 现金录入 + 退费减免（不含改名/控制）
    const financeGrants = [
      'energy:view',
      'energy:detail',
      'energy:export',
      'energy:recharge',
      'energy:refund',
    ];
    // 物业角色补授权：改名/档案
    const propertyGrants = ['energy:rename'];

    const grant = (roleCode: string, permission: string) => {
      const vals = [this.esc(roleCode), this.esc(permission)].join(',');
      return pg
        ? `INSERT INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals}) ON CONFLICT ("role_code","permission_code") DO NOTHING`
        : `INSERT OR IGNORE INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals})`;
    };
    for (const p of financeGrants) await q.query(grant('finance', p));
    for (const p of propertyGrants) await q.query(grant('property', p));
  }

  async down(): Promise<void> {
    // 纯增量：不回滚删除角色/授权/审计表，保留留痕与管理员后续调整结果。
  }
}
