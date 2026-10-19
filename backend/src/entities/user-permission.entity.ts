import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/** 用户级权限覆盖的取值：grant=额外开通；deny=临时关闭。 */
export type UserPermissionEffect = 'grant' | 'deny';

/**
 * 用户 × 权限点 覆盖（RBAC 增强，第二十一轮）。
 * 一行 = 某用户对某权限点的个人例外。
 *
 * 有效权限 = 角色权限 ∪ 用户 grant − 用户 deny；
 * admin 恒为全集，不读取本表对其生效。用户删除时由 FK ON DELETE CASCADE 连带清除。
 */
@Entity({ name: 'rbac_user_permission' })
@Index('uq_rbac_user_permission', ['userId', 'permissionCode'], { unique: true })
export class UserPermission {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 用户 id，关联 users.id。 */
  @Column({ name: 'user_id', type: 'integer' })
  userId!: number;

  /** 权限点 code，关联 rbac_permission.code。 */
  @Column({ name: 'permission_code', type: 'varchar', length: 64 })
  permissionCode!: string;

  /** grant=在角色之外开通；deny=临时收回角色已有权限。 */
  @Column({ name: 'effect', type: 'varchar', length: 8 })
  effect!: UserPermissionEffect;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
