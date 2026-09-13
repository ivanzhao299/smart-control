import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 配置变更审计日志 (Phase 5).
 *
 * 写入时机: 任何把"配置当数据"看的写操作都记一笔 — hardware_unit 改, driver_template 改/删,
 *   device 改, scene 改. (operation_log 记的是 "controlled the device" 类操作,
 *   这张表记的是 "modified the system config", 两者职责不同.)
 *
 * snapshotBefore / snapshotAfter 存全行 JSON, 给回滚用 (回滚 = 把 snapshotBefore 写回去).
 */
@Entity({ name: 'audit_logs' })
export class AuditLog {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 实体类型: 'hardware_unit' / 'driver_template' / 'device' / 'scene' */
  @Index()
  @Column({ type: 'varchar', length: 32 })
  entityType!: string;

  /** 实体 ID (数字主键 toString, 或 kind 这种字符串主键直接放) */
  @Index()
  @Column({ type: 'varchar', length: 64 })
  entityId!: string;

  /** 动作: 'create' / 'update' / 'delete' / 'rollback' */
  @Index()
  @Column({ type: 'varchar', length: 16 })
  action!: 'create' | 'update' | 'delete' | 'rollback';

  /** 操作人 (用户名 / 'system' / 'admin') */
  @Column({ type: 'varchar', length: 64, default: 'admin' })
  operator!: string;

  /** 变更前快照 (整行 JSON), create 时为 null */
  @Column({ type: 'text', nullable: true })
  snapshotBefore!: string | null;

  /** 变更后快照 (整行 JSON), delete 时为 null */
  @Column({ type: 'text', nullable: true })
  snapshotAfter!: string | null;

  /** 备注 / 触发来源 (e.g. 'PUT /api/hardware/1' / 'rollback from audit#42') */
  @Column({ type: 'text', nullable: true })
  remark!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  @Index()
  createdAt!: Date;
}
