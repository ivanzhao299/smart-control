import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 角色 × 电源域 授权 (PowerDomainRoleGrant) — 第十六轮「后台可配的分域授权」。
 *
 * 一行 = 某个角色对某个电源域的访问级别。三态语义：
 *  - 无记录                         → 不可见（该角色在前台/后台完全看不到此域，最小权限）；
 *  - canRead=true, canWrite=false   → 仅可见（能看列表/状态，不能操作开关）；
 *  - canWrite=true（隐含可读）       → 可操作（可单路通断/手动测试，canRead 一并视为 true）。
 *
 * 通用化（关键）：
 *  - role 用普通字符串列，不锁 UserRole 枚举 —— 未来新增任何角色（含 DB 里尚未进枚举的
 *    自定义角色）都能在后台矩阵里配置，无需改后端代码。
 *  - admin / hardware 是「全域锁定角色」，不进本表、矩阵里也不允许改（代码锁死全域，
 *    防止误配导致管理员/硬件工程师自己被关在门外、全场断电）。
 *
 * 矩阵读取：PowerDomainGrantService 启动加载到内存缓存，保存后刷新；
 * 冷启动前 / DB 不可用时回退到 common/auth/rbac.ts 的内置默认矩阵。
 */
@Entity({ name: 'power_domain_role_grant' })
@Index('uq_power_domain_role_grant', ['role', 'domainCode'], { unique: true })
export class PowerDomainRoleGrant {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 角色 code（普通字符串，支持未来新增角色；admin/hardware 锁死全域、不入库）。 */
  @Column({ type: 'varchar', length: 32 })
  role!: string;

  /** 电源域 code，关联 power_domain.code（hall / park / 未来新增楼栋）。 */
  @Column({ type: 'varchar', length: 32, name: 'domain_code' })
  domainCode!: string;

  /** 是否可见（读：列表/状态/详情）。 */
  @Column({ type: 'boolean', name: 'can_read', default: false })
  canRead!: boolean;

  /** 是否可操作（写：单路通断/手动测试；为 true 时隐含可見）。 */
  @Column({ type: 'boolean', name: 'can_write', default: false })
  canWrite!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
