import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 动态角色（RBAC）。
 *
 * - code 为英文小写主键（如 admin / operator / property），稳定、不随改名变化。
 * - 内置角色 is_builtin=true：admin 之外的内置角色可改名/调权限，但不可删除；
 *   admin 为 is_locked=true 的锁定超管，权限恒为全集、不可删/不可停用/不可改权限。
 * - 自定义角色 is_builtin=false，可删除（仍有用户使用时禁止）。
 * - can_front / can_back：该角色是否可登录 PWA 前台 / 后台（管理员在角色上勾选）。
 * - 权限点由 role_permission 关联表逐项勾选；admin 不入库关联，恒全。
 *
 * 目录（权限点）与内置角色的初始投影来自 common/auth/permission-catalog.ts，
 * 由 PermissionService 启动 upsert + 迁移 1792600000000 种子。
 */
@Entity({ name: 'rbac_role' })
export class Role {
  /** 角色 code，英文小写，全局唯一主键。 */
  @PrimaryColumn({ type: 'varchar', length: 32 })
  code!: string;

  /** 中文显示名（如 物业）。 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 角色说明（可选）。 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  description!: string | null;

  /** 是否内置角色（内置不可删，权限默认集受 catalog 约束）。 */
  @Column({ name: 'is_builtin', type: 'boolean', default: false })
  isBuiltin!: boolean;

  /** 是否锁定超管（admin：恒全权限，不可改/删/停用）。 */
  @Column({ name: 'is_locked', type: 'boolean', default: false })
  isLocked!: boolean;

  /** 可登录 PWA 前台。 */
  @Column({ name: 'can_front', type: 'boolean', default: false })
  canFront!: boolean;

  /** 可登录后台。 */
  @Column({ name: 'can_back', type: 'boolean', default: false })
  canBack!: boolean;

  /** 是否启用（停用角色不可登录、不可分配给新用户）。 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** 排序（内置角色按固定顺序，自定义角色排后）。 */
  @Column({ name: 'sort_order', type: 'integer', default: 100 })
  sortOrder!: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
