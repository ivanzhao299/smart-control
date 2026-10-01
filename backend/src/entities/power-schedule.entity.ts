import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * 电源回路自动开关规则 (PowerSchedule) — 2026-10-01 新增。
 *
 * 为 4G 断路器 (庭院亮化/鱼池供氧/园区路灯) 提供定时 + 日落/日出自动开关:
 *   - mode = 'fixed'  : 每天固定时刻 time (HH:mm) 动作
 *   - mode = 'sunset' : 每天日落时刻 (+offsetMin 偏移) 动作 —— 按园区经纬度 NOAA 算法每日重算
 *   - mode = 'sunrise': 每天日出时刻 (+offsetMin 偏移) 动作
 *   - action = 'on' | 'off'
 *   - weekdays: "1,2,3,4,5,6,7" (1=周一) 或空/null = 每天
 *
 * 调度引擎: PowerSchedulesService.onModuleInit 加载 enabled 规则,
 * 每分钟检查一次, 到点调 PowerCircuitsService.turnOn/turnOff (走对应适配器)。
 * 日落时刻每天 0 点重算一次, 避免跨日失效。
 */
export type PowerScheduleMode = 'fixed' | 'sunset' | 'sunrise';
export type PowerScheduleAction = 'on' | 'off';

@Entity({ name: 'power_schedules' })
export class PowerSchedule {
  @PrimaryGeneratedColumn()
  id!: number;

  /** 关联电源回路 (power_circuit.id) */
  @Index()
  @Column({ type: 'integer', name: 'circuit_id' })
  circuitId!: number;

  /** 动作: on=合闸送电 / off=分闸断电 */
  @Column({ type: 'varchar', length: 8 })
  action!: PowerScheduleAction;

  /** 模式: fixed=固定时刻 / sunset=日落 / sunrise=日出 */
  @Column({ type: 'varchar', length: 16 })
  mode!: PowerScheduleMode;

  /** fixed 模式: HH:mm (如 "18:30"); sunset/sunrise 模式忽略 */
  @Column({ type: 'varchar', length: 8, nullable: true })
  time!: string | null;

  /** 日落/日出偏移分钟 (可负; 日落前 30 分钟 = -30) */
  @Column({ type: 'integer', name: 'offset_min', default: 0 })
  offsetMin!: number;

  /** 星期几 "1,2,3,4,5,6,7" (1=周一); 空/null = 每天 */
  @Column({ type: 'varchar', length: 16, nullable: true })
  weekdays!: string | null;

  /** 启用 */
  @Column({ type: 'boolean', default: true })
  enabled!: boolean;

  /** 下一次触发时间 (调度引擎维护, 供前端展示"下次自动动作") */
  @Column({ type: 'datetime', name: 'next_run_at', nullable: true })
  nextRunAt!: Date | null;
  @CreateDateColumn({ name: 'created_at' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt!: Date;
}
