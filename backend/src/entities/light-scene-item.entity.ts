import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

/**
 * 场景项 —— 一条"某目标 → 什么状态"。属于某个 light_scene。
 *
 * 目标可以是单灯或整个分区:
 *   targetType='light', targetRef='GW-DALI-1:12'  → 网关 GW-DALI-1 的短地址 12
 *   targetType='zone',  targetRef='1f-front-hall' → 分区 code (调用时展开成区内所有灯)
 *
 * 调用场景 = 遍历所有 item, 按 on/brightness/kelvin 逐个下发。
 */
@Entity({ name: 'light_scene_item' })
export class LightSceneItem {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 所属场景 code (light_scene.code) */
  @Index()
  @Column({ type: 'varchar', length: 64, name: 'scene_code' })
  sceneCode!: string;

  /** 'light' | 'zone' */
  @Column({ type: 'varchar', length: 16, name: 'target_type' })
  targetType!: string;

  /** light: 'gatewayCode:short'; zone: zoneCode */
  @Column({ type: 'varchar', length: 96, name: 'target_ref' })
  targetRef!: string;

  /** 开/关 */
  @Column({ type: 'boolean', default: true })
  on!: boolean;

  /** 亮度 0-100; null = 不改亮度 (只开关) */
  @Column({ type: 'integer', nullable: true })
  brightness!: number | null;

  /** 色温 K 2500-6500; null = 不改色温 */
  @Column({ type: 'integer', nullable: true })
  kelvin!: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;
}
