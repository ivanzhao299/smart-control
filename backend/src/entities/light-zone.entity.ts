import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 灯光分区 (LightZone) — Sprint E (2026-05-31).
 *
 * 历史: 前端 LightingPage.vue 把 12 个 zone 硬编码在文件里, 每个 zone id
 * 当成 DALI group 号直传给 backend. backend 用 group → slaveId 单值 map
 * 路由命令.
 *
 * 痛点:
 *   - 同一 DALI group 号在不同 gateway 上是物理不同的两束灯 (各自一根
 *     RS485 总线), 单值 map 表达不了
 *   - 新增/调整 zone 必须改前端代码 + 重新部署, 业主自己改不了
 *
 * 这张表把 zone 升格成 DB 一等公民:
 *   - 唯一 id (跟 DALI group 解耦)
 *   - 显式声明 gatewayCode (对应 hardware_unit.code, e.g. GW-DALI-1 / GW-DALI-2)
 *   - 显式声明 daliGroup 1-16
 *   - floor 用于楼层 tab 分组, sortOrder 用于排序
 *   - icon / description 给前端展示
 *
 * 路由: backend 收到 POST /lighting/zone/:id/on, 查 LightZone, 拿到
 * (gatewayCode, daliGroup), 直接调 adapter.setBrightnessOnGateway(gatewayCode, daliGroup, dim).
 * 不再依赖 group→slaveId 的全局 map.
 *
 * 兼容: hardware_unit.addressing.groups 仍保留, 是 health probe / 老 setZoneBrightness
 * 路径用. 新前端走 LightZone 表, 老前端 (如果有) 仍能跑.
 */
@Entity({ name: 'light_zone' })
export class LightZone {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 业务编码, e.g. '1f-front-hall', '2f-test-a'. 唯一. seed/upgrade 走这字段不动 id. */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  code!: string;

  /** 显示名 e.g. '一层前厅 / 园区展示' */
  @Column({ type: 'varchar', length: 128 })
  name!: string;

  /** 楼层 tag, 前端按这个分 tab; 不限值, 但常用 '1F' / '2F' / '3F' / '室外' 等 */
  @Column({ type: 'varchar', length: 16 })
  floor!: string;

  /** 关联的 DALI 网关 code (对应 hardware_unit.code), e.g. 'GW-DALI-1' */
  @Column({ type: 'varchar', length: 64, name: 'gateway_code' })
  gatewayCode!: string;

  /** DALI 组号 1-16 */
  @Column({ type: 'integer', name: 'dali_group' })
  daliGroup!: number;

  /** 显示顺序 (升序), 同楼层内排序; 默认 100 */
  @Column({ type: 'integer', name: 'sort_order', default: 100 })
  sortOrder!: number;

  /** 图标 key (lucide-vue-next 图标名), 默认 'Lightbulb' */
  @Column({ type: 'varchar', length: 32, nullable: true })
  icon!: string | null;

  /** 备注 (现场施工说明, 联系人...) */
  @Column({ type: 'text', nullable: true })
  description!: string | null;

  /** 启用 (禁用后前端不显示, 但保留历史数据) */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
