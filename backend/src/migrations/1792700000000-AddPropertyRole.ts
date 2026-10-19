import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 预置「物业」自定义角色 (2026-10-19, P4 水电前台搬 PWA)。
 *
 * 物业（property）是动态 RBAC 框架下首个由系统预置的「自定义角色」样板：
 *  - is_builtin=0 / is_locked=0：管理员可在角色管理页调整其权限、停用、无用户时删除；
 *  - 仅可登录 PWA 前台（can_front=1），不可登录后台（can_back=0）；
 *  - 授权 energy:view / energy:detail / energy:export：水电总览、逐表明细、
 *    缴费流水 / 欠费清单 / 控制记录查询与 Excel 导出；
 *  - 不授予 energy:readout（召测）、energy:ledger（台账/变压器配置），
 *    也不授予任何设备控制 / 播控 / 系统管理权限。
 *
 * 纯增量、幂等（SQLite INSERT OR IGNORE / PostgreSQL ON CONFLICT DO NOTHING），双方言。
 * PermissionService.syncCatalog 只投影内置 5 角色、不接管自定义角色，故物业角色
 * 由本迁移负责落地；迁移在同一库只执行一次，后续管理员在 UI 上的调整不会被覆盖。
 */
export class AddPropertyRole1792700000000 implements MigrationInterface {
  name = 'AddPropertyRole1792700000000';

  /** SQL 字符串字面量转义（内部受控中文，仍统一转义单引号）。 */
  private esc(v: string | null | undefined): string {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const bool = (v: boolean) => (pg ? (v ? 'true' : 'false') : v ? '1' : '0');

    // 1. 物业自定义角色（前台 / 启用 / 非内置 / 非锁定），按主键 code 幂等。
    const roleCols = [
      'code', 'name', 'description', 'is_builtin', 'is_locked',
      'can_front', 'can_back', 'enabled', 'sort_order',
    ].map((c) => `"${c}"`).join(',');
    const roleVals = [
      this.esc('property'),
      this.esc('物业'),
      this.esc('物业人员：PWA 前台水电总览、逐表明细、缴费/欠费/控制记录查询与 Excel 导出；不可召测、不可配置台账、不可控制设备。'),
      bool(false), // is_builtin：自定义角色
      bool(false), // is_locked：可改可停
      bool(true),  // can_front
      bool(false), // can_back
      bool(true),  // enabled：预置即启用
      '100',
    ].join(',');
    await q.query(
      pg
        ? `INSERT INTO "rbac_role" (${roleCols}) VALUES (${roleVals}) ON CONFLICT ("code") DO NOTHING`
        : `INSERT OR IGNORE INTO "rbac_role" (${roleCols}) VALUES (${roleVals})`,
    );

    // 2. 物业角色 × 水电只读 / 导出权限点，按唯一索引 (role_code, permission_code) 幂等。
    const grants = ['energy:view', 'energy:detail', 'energy:export'];
    for (const permission of grants) {
      const vals = [this.esc('property'), this.esc(permission)].join(',');
      await q.query(
        pg
          ? `INSERT INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals}) ON CONFLICT ("role_code","permission_code") DO NOTHING`
          : `INSERT OR IGNORE INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals})`,
      );
    }
  }

  async down(): Promise<void> {
    // 纯增量：不回滚删除角色 / 授权，保留自定义角色与管理员后续调整结果。
  }
}
