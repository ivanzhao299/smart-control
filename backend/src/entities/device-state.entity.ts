import { Column, Entity, PrimaryColumn } from 'typeorm';

/**
 * 设备最后已知状态 —— 持久化 DeviceStatusService 的内存快照。
 *
 * 为什么要它: 之前设备状态只在内存 Map 里, 后端一重启全部归零成 offline, 要等
 * 下一轮健康检查才逐个恢复 —— 那期间 UI 一片红, 运维也无从判断"重启前它是好的还是
 * 早就掉了"。持久化之后, 重启能立即显示上次已知状态, 排查也有了依据。
 *
 * 用 deviceName 作主键: 一台设备一条, upsert 天然幂等。
 */
@Entity({ name: 'device_states' })
export class DeviceState {
  @PrimaryColumn({ name: 'device_name', type: 'varchar', length: 128 })
  deviceName!: string;

  /** online / offline / running / error / reconnecting / disabled */
  @Column({ type: 'varchar', length: 32, default: 'offline' })
  status!: string;

  /** 状态快照 JSON (亮度/温度/lastCommand 等), 原样存原样取 */
  @Column({ type: 'text', nullable: true })
  state!: string | null;

  /** 最后一次控制命令的时刻 (仅命令类更新才写) */
  @Column({ name: 'last_command_at', type: 'datetime', nullable: true })
  lastCommandAt!: Date | null;

  /** 最后一次控制结果 JSON: {command, result, error} */
  @Column({ name: 'last_command_result', type: 'text', nullable: true })
  lastCommandResult!: string | null;

  @Column({ name: 'updated_at', type: 'datetime' })
  updatedAt!: Date;
}
