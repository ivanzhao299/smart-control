import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-22：把「LED 节目制作」(led-program) 页面授权给运营配置员(config)。
 *
 * 背景：LedProgramPage.vue 是勇电灯珠屏 290×30 节目编排/生成 bin 页面。
 * 此前前台路由白名单为 admin/operator/viewer，config 角色看不到该入口；
 * 后端 BUILTIN_ROLE_PERMISSIONS.config 也未含 led:view。
 *
 * 本迁移幂等补一条 rbac_role_permission 行：config × led:view。
 * （前端路由 main-route-manifest.ts 的 roles 已加 config；
 *   后端 permission-catalog.ts 的 config 默认权限数组也已加 led:view，
 *   冷启动缓存未就绪时 defaultPermissionsForRole 同样放行。）
 *
 * 纯增量、幂等 (INSERT OR IGNORE / ON CONFLICT DO NOTHING)。
 */
export class GrantLedProgramToConfig1793100000000 implements MigrationInterface {
  name = 'GrantLedProgramToConfig1793100000000';

  private esc(v: string): string {
    return `'${v.replace(/'/g, "''")}'`;
  }

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const vals = [this.esc('config'), this.esc('led:view')].join(',');
    await q.query(
      pg
        ? `INSERT INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals}) ON CONFLICT ("role_code","permission_code") DO NOTHING`
        : `INSERT OR IGNORE INTO "rbac_role_permission" ("role_code","permission_code") VALUES (${vals})`,
    );
  }

  async down(): Promise<void> {
    // 纯增量：不回滚删除授权，保留管理员后续调整结果。
  }
}
