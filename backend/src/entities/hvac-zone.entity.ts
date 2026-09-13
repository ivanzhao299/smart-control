import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 空调功能区 (HvacZone) — 2026-07-11.
 *
 * 历史: 14 个功能区硬编码在 `adapters/hvac/hvac-zones.ts` 的 HVAC_ZONES 常量里,
 * 前端 HvacPage 直接展示它。跟灯光分区当初一模一样的痛点:
 *   - 改个区名 / 调整内机归属, 必须改代码 + 重新部署, 业主自己改不了
 *   - 现场分区跟图纸对不上时没法自助修正
 *
 * 所以照搬 LightZone 的做法, 把 zone 升格成 DB 一等公民 —— 前端可直接改名。
 *
 * indoorIdx 说明:
 *   区里存的是"楼层内机序号" (1..22, 见 HVAC_ZONES 原定义: 1F=1-10, 2F=11-22),
 *   不是网关的物理内机号 n。序号 → {gwHost,n} 的映射由 ModbusHvacAdapter 查
 *   devices 表完成 (normalizeDeviceId)。
 *   注意现场物理内机号从 1 起 (1F n=1..10 / 2F n=1..12), 跟这里的序号是两回事。
 *
 * seed: 首次启动时用 HVAC_ZONES 常量灌入本表 (code 幂等, 不覆盖业主改过的名字)。
 */
@Entity({ name: 'hvac_zone' })
export class HvacZone {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 区代号 e.g. 'enterprise_booth' / 'meeting_room'. 唯一, 场景动作按它引用 */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  /** 显示名 e.g. '企业展位' — 业主可在前端直接改 */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 楼层 tag, 前端按这个分 tab: '1F' / '2F' */
  @Column({ type: 'varchar', length: 16 })
  floor!: string;

  /** 区内成员的内机序号 JSON 数组, e.g. "[1,2,3]" (indoorIdx 1..22) */
  @Column({ type: 'text' })
  indoors!: string;

  /** 显示顺序 (升序), 同楼层内排序 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 备注 (机型 / 现场说明) */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** 启用 (禁用后前端不显示, 保留历史数据) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
