import { Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { PowerDomainRoleGrant } from '../../entities/power-domain-role-grant.entity';
import { PowerDomain as PowerDomainEntity } from '../../entities/power-domain.entity';
import { User, USER_ROLES } from '../../entities/user.entity';
import { canWritePowerDomain, readablePowerDomains } from '../../common/auth/rbac';

/**
 * 全域锁定角色：管理员 / 硬件工程师恒为全域（含未来新增域），不进可配矩阵、不允许被改，
 * 防止误配把自己关在门外导致全场断电。
 */
export const POWER_DOMAIN_LOCKED_ROLES: readonly string[] = ['admin', 'hardware'];

/** 角色中文显示名（未来新增角色无映射时回退 code 本身）。 */
const ROLE_LABELS: Record<string, string> = {
  admin: '管理员',
  hardware: '硬件工程师',
  config: '运营配置员',
  operator: '展厅操作员',
  viewer: '观察者',
};

export interface DomainGrantItem {
  role: string;
  domainCode: string;
  canRead: boolean;
  canWrite: boolean;
}

interface Cell {
  read: boolean;
  write: boolean;
}

/**
 * 角色 × 电源域授权服务（第十六轮）：
 *  - 启动时把 power_domain_role_grant 加载到内存矩阵缓存，保存后刷新；
 *  - 锁定角色恒全域；其余角色以 DB 矩阵为准（三态：无记录不可见 / 仅可读 / 可写）；
 *  - 表尚未迁移 / DB 异常时，回退到 common/auth/rbac.ts 的内置默认矩阵，保证前台不挂；
 *  - 可配置角色列表动态得出（内置非锁角色 ∪ users 表实际角色 ∣ 授权表里出现过的角色），
 *    以后新增角色无需改后端即可在矩阵里出现。
 */
@Injectable()
export class PowerDomainGrantService implements OnModuleInit {
  private matrix = new Map<string, Map<string, Cell>>();
  private loaded = false;

  constructor(
    @InjectRepository(PowerDomainRoleGrant)
    private readonly grantRepo: Repository<PowerDomainRoleGrant>,
    @InjectRepository(PowerDomainEntity)
    private readonly domainRepo: Repository<PowerDomainEntity>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly ds: DataSource,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.load();
    } catch {
      // 表尚未迁移等：保持未加载，运行时惰性重试并回退 rbac。
    }
  }

  /** 从 DB 重建内存矩阵。 */
  async load(): Promise<void> {
    const rows = await this.grantRepo.find();
    const next = new Map<string, Map<string, Cell>>();
    for (const r of rows) {
      if (!next.has(r.role)) next.set(r.role, new Map());
      next.get(r.role)!.set(r.domainCode, { read: !!r.canRead, write: !!r.canWrite });
    }
    this.matrix = next;
    this.loaded = true;
  }

  isLocked(role: string | undefined | null): boolean {
    return !!role && POWER_DOMAIN_LOCKED_ROLES.includes(role);
  }

  /** 角色是否可写（操作）某个域。锁定角色全域；无角色/无域默认拒绝。DB 异常回退内置矩阵。 */
  async canWrite(role: string | undefined | null, domainCode: string | undefined | null): Promise<boolean> {
    if (!role || !domainCode) return false;
    if (this.isLocked(role)) return true;
    try {
      if (!this.loaded) await this.load();
      return !!this.matrix.get(role)?.get(domainCode)?.write;
    } catch {
      return canWritePowerDomain(role as never, domainCode);
    }
  }

  /**
   * 角色可读域集合（数据范围）：null = 全域（锁定角色 / 无角色的系统调用）；
   * 数组 = 仅这些域可见（DB 异常回退内置矩阵）。
   */
  async readableDomains(role: string | undefined | null): Promise<string[] | null> {
    if (!role) return null;
    if (this.isLocked(role)) return null;
    try {
      if (!this.loaded) await this.load();
      const rm = this.matrix.get(role);
      if (!rm) return [];
      const codes: string[] = [];
      rm.forEach((g, code) => {
        if (g.read || g.write) codes.push(code);
      });
      return codes;
    } catch {
      return readablePowerDomains(role as never);
    }
  }

  /**
   * 可配置角色（动态）：内置非锁角色 + users 表里实际出现的角色 + 授权表里出现过的角色，
   * 排除锁定角色。内置角色按固定顺序在前，自定义角色按字母序排后。
   */
  async configurableRoles(): Promise<Array<{ role: string; label: string; builtin: boolean }>> {
    const builtin: string[] = USER_ROLES.filter((r) => !POWER_DOMAIN_LOCKED_ROLES.includes(r));
    const set = new Set<string>(builtin);
    try {
      const users = await this.userRepo.find({ select: { role: true } });
      for (const u of users) if (!this.isLocked(u.role)) set.add(u.role);
      const grants = await this.grantRepo.find();
      for (const g of grants) if (!this.isLocked(g.role)) set.add(g.role);
    } catch {
      // 至少保留内置角色
    }
    const ordered = [...set].sort((a, b) => {
      const ia = builtin.indexOf(a);
      const ib = builtin.indexOf(b);
      if (ia >= 0 && ib >= 0) return ia - ib;
      if (ia >= 0) return -1;
      if (ib >= 0) return 1;
      return a.localeCompare(b);
    });
    return ordered.map((role) => ({
      role,
      label: ROLE_LABELS[role] ?? role,
      builtin: builtin.includes(role),
    }));
  }

  /** 后台矩阵视图：启用域 + 可配角色 + 锁定角色 + 当前授权。 */
  async getMatrix() {
    const [domains, roles] = await Promise.all([
      this.domainRepo.find({ order: { sortOrder: 'ASC', id: 'ASC' } }),
      this.configurableRoles(),
    ]);
    try {
      if (!this.loaded) await this.load();
    } catch {
      /* 保持空矩阵 */
    }
    const grants: DomainGrantItem[] = [];
    this.matrix.forEach((dm, role) => {
      dm.forEach((g, domainCode) => {
        grants.push({ role, domainCode, canRead: g.read || g.write, canWrite: g.write });
      });
    });
    return {
      domains: domains.map((d) => ({ code: d.code, name: d.name, enabled: d.enabled })),
      roles,
      lockedRoles: POWER_DOMAIN_LOCKED_ROLES.map((role) => ({ role, label: ROLE_LABELS[role] ?? role })),
      grants,
    };
  }

  /**
   * 全量替换授权（事务）。锁定角色的行一律忽略；可写隐含可读；新域默认非锁角色不可见。
   * 保存后刷新内存缓存。
   */
  async replaceGrants(items: DomainGrantItem[]): Promise<void> {
    const clean = (items ?? [])
      .filter((i) => i && i.role && i.domainCode && !this.isLocked(i.role))
      .map((i) => ({
        role: String(i.role).trim(),
        domainCode: String(i.domainCode).trim(),
        canRead: !!(i.canWrite || i.canRead),
        canWrite: !!i.canWrite,
      }));
    await this.ds.transaction(async (mgr) => {
      await mgr.createQueryBuilder().delete().from(PowerDomainRoleGrant).execute();
      if (clean.length) await mgr.save(PowerDomainRoleGrant, clean);
    });
    await this.load();
  }
}
