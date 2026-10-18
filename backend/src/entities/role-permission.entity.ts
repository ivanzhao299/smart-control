import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 角色 × 权限点 关联（RBAC）。
 * 一行 = 某角色被授予某原子权限点。admin（is_locked）不入库，恒为全集。
 * 角色授权在后台全量替换（删除该角色旧关联 → 保存勾选集合），保存后刷新内存缓存。
 */
@Entity({ name: 'rbac_role_permission' })
@Index('uq_rbac_role_permission', ['roleCode', 'permissionCode'], { unique: true })
export class RolePermission {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 角色 code，关联 rbac_role.code。 */
  @Column({ name: 'role_code', type: 'varchar', length: 32 })
  roleCode!: string;

  /** 权限点 code，关联 rbac_permission.code。 */
  @Column({ name: 'permission_code', type: 'varchar', length: 64 })
  permissionCode!: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
