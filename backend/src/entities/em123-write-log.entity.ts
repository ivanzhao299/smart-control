import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * em123 水电写操作审计流水 (Em123WriteLog) — 二/三期 (2026-10-19)。
 *
 * 凡经我方后端代理、会改变 em123 平台数据或现场供电状态的操作，一律落一条本表：
 *   二期：住房改名 house_rename / 业主改名 user_rename / 表档案 meter_edit /
 *         现金充值 charge_cash / 补量 charge_supplement / 退费 refund / 减免 reduction；
 *   三期：拉闸 control_off / 合闸 control_on / 校时 settime / 多费率 setrate。
 *
 * 设计目的：
 *   - 资金类（充值/退费/减免）可逐笔对账：金额、前后余额、操作人、平台返回、时间；
 *   - 控制类（拉合闸）完整留痕：户名、原因、操作人，可与平台 30065+ 条控制记录双向核对；
 *   - 改名/档案保留前后值快照，便于追溯与回滚参考。
 *
 * 平台侧成功与否都记录（status=success/failed），失败也要可见、可排查。
 */
export type Em123WriteBizType =
  | 'house_rename'
  | 'user_rename'
  | 'meter_edit'
  | 'charge_cash'
  | 'charge_supplement'
  | 'refund'
  | 'reduction'
  | 'control_off'
  | 'control_on'
  | 'settime'
  | 'setrate';

export type Em123WriteStatus = 'success' | 'failed';

@Entity({ name: 'em123_write_log' })
@Index('ix_em123_write_log_created', ['createdAt'])
@Index('ix_em123_write_log_type_meter', ['bizType', 'meterNo'])
export class Em123WriteLog {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 业务操作类型，见 Em123WriteBizType */
  @Column({ type: 'varchar', length: 24, name: 'biz_type' })
  bizType!: string;

  /** 表类型: E=电 / W=水（档案/资金类可空） */
  @Column({ type: 'varchar', length: 2, name: 'meter_type', nullable: true })
  meterType!: string | null;

  /** 表号 */
  @Column({ type: 'varchar', length: 64, name: 'meter_no', nullable: true })
  meterNo!: string | null;

  /** 平台表计 id（字符串，若依主键） */
  @Column({ type: 'varchar', length: 32, name: 'meter_id', nullable: true })
  meterId!: string | null;

  /** 平台住房 id */
  @Column({ type: 'varchar', length: 32, name: 'house_id', nullable: true })
  houseId!: string | null;

  /** 住房名（客户名称） */
  @Column({ type: 'varchar', length: 128, name: 'house_name', nullable: true })
  houseName!: string | null;

  /** 业主户名 */
  @Column({ type: 'varchar', length: 64, name: 'user_name', nullable: true })
  userName!: string | null;

  /** 资金类金额（元，充值为正 / 退费减免按业务）；非资金类为 0 */
  @Column({ type: 'double precision', name: 'amount', default: 0 })
  amount!: number;

  /** 操作前余额（元） */
  @Column({ type: 'double precision', name: 'before_balance', nullable: true })
  beforeBalance!: number | null;

  /** 操作后余额（元，平台回显或前端计算） */
  @Column({ type: 'double precision', name: 'after_balance', nullable: true })
  afterBalance!: number | null;

  /** 原因 / 备注（拉合闸原因必填，资金备注可选） */
  @Column({ type: 'varchar', length: 256, name: 'reason', nullable: true })
  reason!: string | null;

  /** 操作前档案快照（JSON 字符串） */
  @Column({ type: 'text', name: 'payload_before', nullable: true })
  payloadBefore!: string | null;

  /** 提交参数 / 操作后快照（JSON 字符串） */
  @Column({ type: 'text', name: 'payload_after', nullable: true })
  payloadAfter!: string | null;

  /** 平台返回 code（0=成功） */
  @Column({ type: 'integer', name: 'platform_code', nullable: true })
  platformCode!: number | null;

  /** 平台返回 msg */
  @Column({ type: 'varchar', length: 256, name: 'platform_msg', nullable: true })
  platformMsg!: string | null;

  /** success / failed */
  @Column({ type: 'varchar', length: 8, default: 'success' })
  status!: string;

  /** 我方操作人用户 id */
  @Column({ type: 'integer', name: 'operator_id', nullable: true })
  operatorId!: number | null;

  /** 我方操作人登录名 */
  @Column({ type: 'varchar', length: 64, name: 'operator_name', nullable: true })
  operatorName!: string | null;

  /** 我方操作人角色 code */
  @Column({ type: 'varchar', length: 32, name: 'operator_role', nullable: true })
  operatorRole!: string | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
