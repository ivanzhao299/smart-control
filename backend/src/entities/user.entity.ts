import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 角色体系（2026-10-13 细分为后台分域角色）：
 * - admin     超级管理员：系统类全权（用户/角色、系统设置、发版、审计回滚）。
 * - hardware  硬件工程师：后台「设备与分区」「日志诊断」分域可写。
 * - config    运营配置员：后台「日常运行」「欢迎页/运营数据」分域可写。
 * - operator  展厅操作员：前台 PWA 运营；后台仅自助改密码 + 只读下载 APK。
 * - viewer    观察者：只读账户（仅 GET，不能进后台）。
 * 分域矩阵见 common/auth/rbac.ts。
 */
export const USER_ROLES = ['admin', 'hardware', 'config', 'operator', 'viewer'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/**
 * 可登录后台的角色。
 * - admin / hardware / config：后台管理员与两个后台专员。
 * - operator：展厅操作员，仅能登录后台使用「修改密码」与「APP 版本(只读下载)」两个自助项，
 *   其余模块由 rbac.ts 矩阵全部隐藏/挡写。
 * - viewer：仅前台，不能进后台。
 */
export const BACKEND_ROLES: readonly UserRole[] = ['admin', 'hardware', 'config', 'operator'];

@Entity({ name: 'users' })
export class User {
  @Column({ name: 'storage_quota_bytes', type: 'bigint', default: 10737418240 })
  storageQuotaBytes!: number;

  @PrimaryGeneratedColumn()
  id!: number;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  username!: string;

  @Column({ type: 'varchar', length: 256, select: false })
  password!: string;

  /**
   * 动态角色 code（RBAC 后为普通字符串，长度放宽到 32 以容纳自定义角色）。
   * 角色是否存在/启用由 rbac_role 表与 PermissionService 校验，不再由枚举约束。
   */
  @Column({ type: 'varchar', length: 32, default: 'viewer' })
  role!: string;

  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
