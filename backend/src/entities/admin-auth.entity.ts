import { Column, Entity, PrimaryGeneratedColumn, UpdateDateColumn } from 'typeorm';

/**
 * 后台鉴权配置 — 单行表 (id=1), 存"管理员密码哈希".
 *
 * 跟 user.entity.ts 的多用户系统刻意分开:
 *   - user.entity: 给将来的多角色 / 多账户 / 操作审计用 (admin / operator / viewer)
 *   - admin-auth: 当前是单密码门禁, 谁都进 /admin 要先输这个口令.
 *     业主把口令交给现场维护方就行, 不用一人一账号.
 *
 * 启动时 service 检查没有就插默认 (hash("jinhu888")), 业主进后台第一件事
 * 改成自己的. 改密码也走这张表的 update.
 *
 * 所有 nullable 字段都显式 type:'varchar' (踩过 string|null 反射成 Object 的坑).
 */
@Entity({ name: 'admin_auth_v1' })
export class AdminAuth {
  @PrimaryGeneratedColumn()
  id!: number;

  /** scrypt 哈希后的密码, 格式 scrypt$N$salt$hash, 同 users 表那套 */
  @Column({ type: 'varchar', length: 255 })
  passwordHash!: string;

  /** 哪个 session 上次改过密码, 用于密码改后让其他 session 失效 (passwordChangedAt > token.issuedAt 即失效) */
  @Column({ type: 'datetime' })
  passwordChangedAt!: Date;

  @UpdateDateColumn()
  updatedAt!: Date;
}
