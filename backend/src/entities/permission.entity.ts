import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 原子权限点（RBAC）。
 *
 * 表内容由代码目录 common/auth/permission-catalog.ts 在启动时 upsert 投影，
 * 不提供后台手工增删（权限点必须与后端 @RequirePermission 守卫对应，纯 DB 新增无意义）。
 * 后台角色勾选树读这张表，按 group 分组、按 sort_order 排序。
 */
@Entity({ name: 'rbac_permission' })
export class Permission {
  /** 权限点 code，形如 `资源:动作`（如 energy:export），主键。 */
  @PrimaryColumn({ type: 'varchar', length: 64 })
  code!: string;

  /** 中文名。 */
  @Column({ type: 'varchar', length: 64 })
  name!: string;

  /** 所属分组 code（permission-catalog 的 PermissionGroupCode）。 */
  @Column({ type: 'varchar', length: 32 })
  grp!: string;

  /** view=只读；write=操作/管理；admin=系统级默认仅超管。 */
  @Column({ type: 'varchar', length: 16 })
  kind!: string;

  /** front=前台；back=后台；both=两端。 */
  @Column({ type: 'varchar', length: 16 })
  scope!: string;

  /** 组内排序。 */
  @Column({ name: 'sort_order', type: 'integer', default: 0 })
  sortOrder!: number;

  /** 备注（边界/行级说明，可空）。 */
  @Column({ type: 'varchar', length: 255, nullable: true })
  hint!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
