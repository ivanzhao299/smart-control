import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PERMISSION_CATALOG,
  BUILTIN_ROLES,
  BUILTIN_ROLE_PERMISSIONS,
} from '../common/auth/permission-catalog';

/**
 * 动态 RBAC 三表 + 种子 (2026-10-18, 第十八轮「动态角色与原子权限」)。
 *
 * 纯增量、幂等 (CREATE TABLE/INDEX IF NOT EXISTS, 种子 ON CONFLICT / INSERT OR IGNORE)，
 * 双方言 (生产 PostgreSQL / 本地 SQLite)。
 *
 *   rbac_role            角色（code 主键；含内置 5 角色 + 管理员后续新建的自定义角色）
 *   rbac_permission      原子权限点（约 50 个，由 permission-catalog 投影）
 *   rbac_role_permission 角色 × 权限点 勾选
 *
 * 权限点 / 内置角色的运行时补齐由 PermissionService 启动 upsert 负责；本迁移只做首次建库
 * 种子，二者都幂等，保证离线/旧库也能得到一致基线。
 *
 * 同时把 users.role 由 varchar(16) 放宽到 varchar(32)（自定义角色 code 预留空间，
 * 仅 PostgreSQL 需要显式 ALTER；SQLite 的 varchar 长度不强制）。
 *
 * 种子与迁移前硬编码矩阵（rbac.ts + 各 controller 装饰器 + 前端路由清单）逐条对齐，
 * 上线当天零行为变化。admin 锁定全权限，不写入 rbac_role_permission。
 */
export class CreateDynamicRbac1792600000000 implements MigrationInterface {
  name = 'CreateDynamicRbac1792600000000';

  /** SQL 字符串字面量转义（catalog 文本为内部受控中文，仍统一转义单引号）。 */
  private esc(v: string | null | undefined): string {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
  }

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";
    const bool = (v: boolean) => (pg ? (v ? 'true' : 'false') : v ? '1' : '0');
    const serial = pg ? 'SERIAL' : 'integer';
    const conflictIgnore = (table: string, cols: string[], values: string) => {
      const list = cols.map((c) => `"${c}"`).join(',');
      return pg
        ? `INSERT INTO "${table}" (${list}) VALUES (${values}) ON CONFLICT (${list}) DO NOTHING`
        : `INSERT OR IGNORE INTO "${table}" (${list}) VALUES (${values})`;
    };

    // ---------- 1. 角色表 ----------
    await q.query(`CREATE TABLE IF NOT EXISTS "rbac_role" (
      "code" varchar(32) PRIMARY KEY,
      "name" varchar(64) NOT NULL,
      "description" varchar(255),
      "is_builtin" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "is_locked" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "can_front" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "can_back" boolean NOT NULL DEFAULT ${pg ? 'false' : '0'},
      "enabled" boolean NOT NULL DEFAULT ${pg ? 'true' : '1'},
      "sort_order" integer NOT NULL DEFAULT 100,
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);

    // ---------- 2. 权限点表 ----------
    await q.query(`CREATE TABLE IF NOT EXISTS "rbac_permission" (
      "code" varchar(64) PRIMARY KEY,
      "name" varchar(64) NOT NULL,
      "grp" varchar(32) NOT NULL,
      "kind" varchar(16) NOT NULL,
      "scope" varchar(16) NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 0,
      "hint" varchar(255),
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);

    // ---------- 3. 角色 × 权限点表 ----------
    await q.query(`CREATE TABLE IF NOT EXISTS "rbac_role_permission" (
      "id" ${serial} PRIMARY KEY,
      "role_code" varchar(32) NOT NULL,
      "permission_code" varchar(64) NOT NULL,
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_rbac_role_permission"
       ON "rbac_role_permission" ("role_code","permission_code")`,
    );
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_rbac_role_permission_perm"
       ON "rbac_role_permission" ("permission_code")`,
    );

    // ---------- 4. 放宽 users.role 到 varchar(32)（仅 PG 需要显式改类型） ----------
    if (pg) {
      await q.query(`ALTER TABLE "users" ALTER COLUMN "role" TYPE varchar(32)`);
    }

    // ---------- 5. 种子权限点（catalog 全集，幂等） ----------
    for (const p of PERMISSION_CATALOG) {
      await q.query(conflictIgnore(
        'rbac_permission',
        ['code', 'name', 'grp', 'kind', 'scope', 'sort_order', 'hint'],
        [
          this.esc(p.code), this.esc(p.name), this.esc(p.group),
          this.esc(p.kind), this.esc(p.scope), String(p.sort), this.esc(p.hint ?? null),
        ].join(','),
      ));
    }

    // ---------- 6. 种子内置角色（幂等） ----------
    for (const r of BUILTIN_ROLES) {
      await q.query(conflictIgnore(
        'rbac_role',
        ['code', 'name', 'description', 'is_builtin', 'is_locked', 'can_front', 'can_back', 'enabled', 'sort_order'],
        [
          this.esc(r.code), this.esc(r.name), this.esc(r.description),
          bool(true), bool(!!r.lockedFull), bool(r.canFront), bool(r.canBack), bool(true), String(r.sort),
        ].join(','),
      ));
    }

    // ---------- 7. 种子内置角色权限（admin 锁定全权限，不入库） ----------
    for (const [role, perms] of Object.entries(BUILTIN_ROLE_PERMISSIONS)) {
      for (const permission of perms) {
        await q.query(conflictIgnore(
          'rbac_role_permission',
          ['role_code', 'permission_code'],
          [this.esc(role), this.esc(permission)].join(','),
        ));
      }
    }
  }

  async down(): Promise<void> {
    // 纯增量 RBAC 表；不回滚（保留角色与授权数据，避免回滚删库）。
  }
}
