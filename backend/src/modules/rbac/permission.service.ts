import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DataSource, In, Repository } from 'typeorm';
import { Logger } from 'winston';
import { Role } from '../../entities/role.entity';
import { Permission } from '../../entities/permission.entity';
import { RolePermission } from '../../entities/role-permission.entity';
import { User } from '../../entities/user.entity';
import { OperationLogService } from '../logs/operation-log.service';
import {
  ALL_PERMISSION_CODES,
  BUILTIN_ROLES,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  isFullAccessRole,
  isKnownPermission,
  defaultPermissionsForRole,
} from '../../common/auth/permission-catalog';

export interface RoleMeta {
  code: string;
  name: string;
  description: string | null;
  isBuiltin: boolean;
  isLocked: boolean;
  canFront: boolean;
  canBack: boolean;
  enabled: boolean;
  sortOrder: number;
}

export interface RoleListRow extends RoleMeta {
  userCount: number;
  permissionCount: number;
}

export interface CreateRoleInput {
  code: string;
  name: string;
  description?: string | null;
  canFront?: boolean;
  canBack?: boolean;
  /** 新角色默认停用（安全优先），由管理员显式开启。 */
  enabled?: boolean;
  permissions?: string[];
}

export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  canFront?: boolean;
  canBack?: boolean;
  enabled?: boolean;
}

const CODE_RE = /^[a-z][a-z0-9_-]{1,31}$/;

/**
 * 动态 RBAC 权限服务（第十八轮）：
 *  - 启动把代码目录 permission-catalog 投影到 rbac_permission，并把内置角色元数据补齐到 rbac_role；
 *  - 角色元数据与角色×权限矩阵常驻内存（Map），保存后刷新；
 *  - admin（is_locked / catalog lockedFull）恒为全权限，不查 DB；
 *  - 表尚未迁移 / DB 异常时回退到 catalog 内置默认，保证登录与前台不挂；
 *  - 提供角色 CRUD / 复制 / 授权全量替换，含内置不可删、有人用不可删、锁定不可改等保护。
 */
@Injectable()
export class PermissionService implements OnModuleInit {
  private roleMeta = new Map<string, RoleMeta>();
  private grants = new Map<string, Set<string>>();
  private loaded = false;

  constructor(
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Permission) private readonly permissionRepo: Repository<Permission>,
    @InjectRepository(RolePermission) private readonly grantRepo: Repository<RolePermission>,
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    private readonly ds: DataSource,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.syncCatalog();
    } catch (error) {
      this.logger.warn(`RBAC 权限点投影失败（表尚未迁移？）: ${(error as Error).message}`, { context: 'PermissionService' });
    }
    try {
      await this.load();
    } catch (error) {
      this.logger.warn(`RBAC 矩阵加载失败，运行时回退内置默认: ${(error as Error).message}`, { context: 'PermissionService' });
    }
  }

  /** 把代码目录投影到 rbac_permission，并确保内置角色行存在（幂等，不覆盖已做调整）。 */
  async syncCatalog(): Promise<void> {
    for (const p of PERMISSION_CATALOG) {
      await this.permissionRepo.createQueryBuilder()
        .insert()
        .into(Permission)
        .values({
          code: p.code, name: p.name, grp: p.group, kind: p.kind,
          scope: p.scope, sortOrder: p.sort, hint: p.hint ?? null,
        })
        .orIgnore()
        .execute();
    }
    for (const r of BUILTIN_ROLES) {
      await this.roleRepo.createQueryBuilder()
        .insert()
        .into(Role)
        .values({
          code: r.code, name: r.name, description: r.description,
          isBuiltin: true, isLocked: !!r.lockedFull,
          canFront: r.canFront, canBack: r.canBack, enabled: true, sortOrder: r.sort,
        })
        .orIgnore()
        .execute();
    }
  }

  /** 从 DB 重建角色元数据与权限矩阵缓存。 */
  async load(): Promise<void> {
    const [roleRows, grantRows] = await Promise.all([
      this.roleRepo.find(),
      this.grantRepo.find(),
    ]);
    const meta = new Map<string, RoleMeta>();
    for (const r of roleRows) {
      meta.set(r.code, {
        code: r.code, name: r.name, description: r.description,
        isBuiltin: !!r.isBuiltin, isLocked: !!r.isLocked,
        canFront: !!r.canFront, canBack: !!r.canBack,
        enabled: !!r.enabled, sortOrder: r.sortOrder,
      });
    }
    const next = new Map<string, Set<string>>();
    for (const g of grantRows) {
      if (!next.has(g.roleCode)) next.set(g.roleCode, new Set());
      next.get(g.roleCode)!.add(g.permissionCode);
    }
    this.roleMeta = meta;
    this.grants = next;
    this.loaded = true;
  }

  private ensureLoaded(): void {
    if (!this.loaded) {
      // 同步读不可行；调用方走 async 入口。这里只标记，实际 load 由 onModuleInit 完成。
      // 若尚未就绪（极端冷启动），各读方法回退 catalog 默认。
    }
  }

  private metaOf(role: string): RoleMeta | undefined {
    return this.roleMeta.get(role);
  }

  /** 角色是否启用（admin 恒真；DB 未就绪回退内置默认）。 */
  isRoleEnabled(role: string | undefined | null): boolean {
    if (!role) return false;
    if (isFullAccessRole(role)) return true;
    const meta = this.metaOf(role);
    if (meta) return meta.enabled;
    // 回退：内置角色视为启用（表未迁移时不挡住老用户）。
    return BUILTIN_ROLES.some((r) => r.code === role);
  }

  /** 角色是否存在且启用（用户创建/更新校验用）。 */
  async roleExistsEnabled(role: string | undefined | null): Promise<boolean> {
    if (!role) return false;
    if (isFullAccessRole(role)) return true;
    try {
      if (!this.loaded) await this.load();
    } catch {
      return BUILTIN_ROLES.some((r) => r.code === role);
    }
    return this.metaOf(role)?.enabled === true;
  }

  /** 是否可登录 PWA 前台（admin 恒真；回退内置 catalog）。 */
  canLoginFront(role: string | undefined | null): boolean {
    if (!role) return false;
    if (isFullAccessRole(role)) return true;
    const meta = this.metaOf(role);
    if (meta) return meta.enabled && meta.canFront;
    return BUILTIN_ROLES.find((r) => r.code === role)?.canFront ?? false;
  }

  /** 是否可登录后台（admin 恒真；回退内置 catalog）。 */
  canLoginBack(role: string | undefined | null): boolean {
    if (!role) return false;
    if (isFullAccessRole(role)) return true;
    const meta = this.metaOf(role);
    if (meta) return meta.enabled && meta.canBack;
    return BUILTIN_ROLES.find((r) => r.code === role)?.canBack ?? false;
  }

  /** 角色是否拥有某权限点（admin 恒全；DB 异常回退 catalog 默认）。 */
  hasPermission(role: string | undefined | null, code: string): boolean {
    if (!role) return false;
    if (isFullAccessRole(role)) return true;
    const meta = this.metaOf(role);
    if (meta && !meta.enabled) return false;
    const set = this.grants.get(role);
    if (set) return set.has(code);
    if (!this.loaded) {
      // 冷启动缓存未就绪：回退内置默认，避免启动瞬间误拒。
      return defaultPermissionsForRole(role).includes(code);
    }
    return false;
  }

  /** 角色全部权限点 code（admin 全集；DB 异常回退 catalog 默认）。 */
  permissionsFor(role: string | undefined | null): string[] {
    if (!role) return [];
    if (isFullAccessRole(role)) return [...ALL_PERMISSION_CODES];
    const set = this.grants.get(role);
    if (set) return [...set];
    if (!this.loaded) return defaultPermissionsForRole(role);
    return [];
  }

  // ================= 后台管理（仅 admin，由 controller 守卫保证） =================

  /** 权限点目录（分组树，源自代码 catalog）。 */
  getCatalog() {
    return {
      groups: PERMISSION_GROUPS.map((g) => ({ code: g.code, name: g.name, sort: g.sort })),
      permissions: PERMISSION_CATALOG.map((p) => ({ ...p })),
    };
  }

  /** 角色列表（含用户数、权限数），内置在前、自定义按 sort/code。 */
  async listRoles(): Promise<RoleListRow[]> {
    let metas: RoleMeta[];
    try {
      if (!this.loaded) await this.load();
      metas = [...this.roleMeta.values()];
    } catch {
      metas = BUILTIN_ROLES.map((r) => ({
        code: r.code, name: r.name, description: r.description,
        isBuiltin: true, isLocked: !!r.lockedFull, canFront: r.canFront,
        canBack: r.canBack, enabled: true, sortOrder: r.sort,
      }));
    }
    metas.sort((a, b) => (a.sortOrder - b.sortOrder) || a.code.localeCompare(b.code));

    const rows: RoleListRow[] = [];
    for (const m of metas) {
      let userCount = 0;
      try {
        userCount = await this.userRepo.count({ where: { role: m.code as never } });
      } catch {
        userCount = 0;
      }
      const permissionCount = isFullAccessRole(m.code)
        ? ALL_PERMISSION_CODES.length
        : (this.grants.get(m.code)?.size ?? 0);
      rows.push({ ...m, userCount, permissionCount });
    }
    return rows;
  }

  /** 角色详情：元数据 + 权限 code 列表。 */
  async getRole(code: string) {
    if (!this.loaded) await this.load();
    const meta = this.metaOf(code);
    if (!meta) throw new NotFoundException(`角色不存在: ${code}`);
    return {
      ...meta,
      // 锁定角色回显全集（其权限不入库）。
      permissions: this.permissionsFor(code),
    };
  }

  private assertCode(code: string): void {
    if (!CODE_RE.test(code)) {
      throw new ConflictException('角色 code 需为 2-32 位小写字母开头，可含小写字母/数字/_/-');
    }
  }

  async createRole(input: CreateRoleInput, operator: string): Promise<RoleMeta> {
    const code = String(input.code ?? '').trim();
    const name = String(input.name ?? '').trim();
    this.assertCode(code);
    if (!name) throw new ConflictException('角色名称不能为空');
    if (BUILTIN_ROLES.some((r) => r.code === code)) {
      throw new ConflictException(`不能使用内置角色 code：${code}`);
    }
    const perms = (input.permissions ?? []).filter(isKnownPermission);
    return this.ds.transaction(async (mgr) => {
      const exists = await mgr.findOne(Role, { where: { code } });
      if (exists) throw new ConflictException(`角色 code 已存在: ${code}`);
      const saved = await mgr.save(Role, mgr.create(Role, {
        code,
        name,
        description: input.description ?? null,
        isBuiltin: false,
        isLocked: false,
        canFront: !!input.canFront,
        canBack: !!input.canBack,
        // 自定义角色默认停用，管理员显式开启。
        enabled: input.enabled ?? false,
        sortOrder: 1000,
      }));
      if (perms.length) {
        await mgr.save(RolePermission, perms.map((permissionCode) => mgr.create(RolePermission, { roleCode: code, permissionCode })));
      }
      return saved;
    }).then(async (r) => {
      await this.load();
      await this.record(operator, 'role.create', code, `新建角色 ${name}(${code}) 权限${perms.length}项`);
      return this.metaOf(r.code)!;
    });
  }

  async updateRole(code: string, input: UpdateRoleInput, operator: string): Promise<RoleMeta> {
    if (!this.loaded) await this.load();
    const meta = this.metaOf(code);
    if (!meta) throw new NotFoundException(`角色不存在: ${code}`);
    if (meta.isLocked) {
      // 锁定超管：只允许改显示名/描述，禁止改动登录方向/启用态（防自锁）。
      const lockedKeys = Object.keys(input).filter((k) => k !== 'name' && k !== 'description');
      if (lockedKeys.length) throw new ForbiddenException('锁定超管的登录方向与启用状态不可修改');
    }
    // 禁止停用最后一个启用的 admin（users 表有 trigger；这里再挡 role 维度）。
    if (input.enabled === false && isFullAccessRole(code)) {
      throw new ConflictException('不能停用最后一个超级管理员');
    }
    const patch: Partial<Role> = {};
    if (input.name !== undefined) patch.name = String(input.name).trim() || meta.name;
    if (input.description !== undefined) patch.description = input.description;
    if (input.canFront !== undefined) patch.canFront = input.canFront;
    if (input.canBack !== undefined) patch.canBack = input.canBack;
    if (input.enabled !== undefined) patch.enabled = input.enabled;
    await this.roleRepo.update({ code }, patch);
    await this.load();
    await this.record(operator, 'role.update', code, `更新角色 ${meta.name}(${code})`);
    return this.metaOf(code)!;
  }

  async deleteRole(code: string, operator: string): Promise<void> {
    if (!this.loaded) await this.load();
    const meta = this.metaOf(code);
    if (!meta) throw new NotFoundException(`角色不存在: ${code}`);
    if (meta.isBuiltin) throw new ConflictException('内置角色不可删除（可停用）');
    if (isFullAccessRole(code)) throw new ConflictException('超级管理员不可删除');
    const userCount = await this.userRepo.count({ where: { role: code as never } });
    if (userCount > 0) {
      throw new ConflictException(`仍有 ${userCount} 个用户使用该角色，请先把这些用户改派其他角色后再删除`);
    }
    await this.ds.transaction(async (mgr) => {
      await mgr.delete(RolePermission, { roleCode: code });
      await mgr.delete(Role, { code });
    });
    await this.load();
    await this.record(operator, 'role.delete', code, `删除角色 ${meta.name}(${code})`);
  }

  /** 全量替换角色权限（锁定角色拒绝）。 */
  async replacePermissions(code: string, permissions: string[], operator: string): Promise<string[]> {
    if (!this.loaded) await this.load();
    const meta = this.metaOf(code);
    if (!meta) throw new NotFoundException(`角色不存在: ${code}`);
    if (meta.isLocked || isFullAccessRole(code)) {
      throw new ForbiddenException('锁定超管的权限不可修改');
    }
    const clean = [...new Set((permissions ?? []).filter(isKnownPermission))];
    await this.ds.transaction(async (mgr) => {
      await mgr.delete(RolePermission, { roleCode: code });
      if (clean.length) {
        await mgr.save(RolePermission, clean.map((permissionCode) => mgr.create(RolePermission, { roleCode: code, permissionCode })));
      }
    });
    await this.load();
    await this.record(operator, 'role.grant', code, `保存角色 ${meta.name}(${code}) 权限 ${clean.length} 项`);
    return clean;
  }

  /** 复制角色（含权限集与登录方向），新角色默认停用。 */
  async copyRole(sourceCode: string, input: CreateRoleInput, operator: string): Promise<RoleMeta> {
    const source = await this.getRole(sourceCode).catch(() => null);
    if (!source) throw new NotFoundException(`源角色不存在: ${sourceCode}`);
    const merged: CreateRoleInput = {
      ...input,
      canFront: input.canFront ?? source.canFront,
      canBack: input.canBack ?? source.canBack,
      enabled: false,
      permissions: input.permissions ?? source.permissions,
    };
    const created = await this.createRole(merged, operator);
    await this.record(operator, 'role.copy', created.code, `从 ${sourceCode} 复制为 ${created.code}`);
    return created;
  }

  private async record(operator: string, action: string, targetId: string, message: string): Promise<void> {
    try {
      await this.logService.record({ operator, action, targetType: 'role', targetId, message });
    } catch {
      /* 审计失败不阻断主流程 */
    }
  }

  /** 供前端 /me 一次性下发：权限集 + 登录方向。 */
  identity(role: string | undefined | null) {
    this.ensureLoaded();
    const meta = role ? this.metaOf(role) : undefined;
    const roleName = meta?.name
      ?? BUILTIN_ROLES.find((r) => r.code === role)?.name
      ?? role
      ?? '';
    return {
      roleName,
      permissions: this.permissionsFor(role),
      canFront: this.canLoginFront(role),
      canBack: this.canLoginBack(role),
    };
  }
}
