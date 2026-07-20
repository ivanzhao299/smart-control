import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceStatus } from '../entities/device.entity';
import { DeviceState } from '../entities/device-state.entity';
import { ControlBus } from './control-bus';

export interface DeviceStatusSnapshot {
  device: string;
  status: DeviceStatus;
  state: Record<string, unknown>;
  updatedAt: string;
}

@Injectable()
export class DeviceStatusService implements OnModuleInit {
  private cache = new Map<string, DeviceStatusSnapshot>();

  /**
   * 'running' 的存活时长 — 默认 2 分钟, DEVICE_RUNNING_TTL_MS 可调.
   *
   * 背景: CommandDispatcher 每次命令成功就把设备置成 'running', 但**没有任何东西把它
   * 改回去** —— 只要没有新命令/新状态, 这条快照就永远停在 "运行中", 界面和
   * health 汇总 (online = online|running) 全被它带偏, 设备早就没响应了看着还在跑.
   *
   * 处理: 读取时惰性降级 (不改 cache、不加定时器、零副作用). 超时回落到 'online' 而不是
   * 'offline' —— 命令刚成功过说明链路是通的, 只是不再"运行中"; 真离线由
   * DeviceHealthService 的 probe 判, 这里不抢它的活 (自愈机制不跟人抢控制权).
   */
  private readonly runningTtlMs = Number.parseInt(
    process.env.DEVICE_RUNNING_TTL_MS ?? '120000',
    10,
  );

  constructor(
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    @InjectRepository(DeviceState) private readonly stateRepo: Repository<DeviceState>,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 启动时把上次已知状态从表里捞回内存 —— 重启后 UI 立即有数据, 不再一片红等健康检查。
   * 捞回的时间戳是上次运行的, decayRunning 会自动把过期的 'running' 降级, 所以重启后
   * 不会误显示"运行中"。
   */
  async onModuleInit(): Promise<void> {
    try {
      const rows = await this.stateRepo.find();
      for (const r of rows) {
        let parsed: Record<string, unknown> = {};
        try {
          parsed = r.state ? (JSON.parse(r.state) as Record<string, unknown>) : {};
        } catch {
          /* 坏 JSON 就当空状态, 不影响其它设备 */
        }
        this.cache.set(r.deviceName, {
          device: r.deviceName,
          status: r.status as DeviceStatus,
          state: parsed,
          updatedAt: r.updatedAt.toISOString(),
        });
      }
      if (rows.length > 0) {
        this.logger.info(`已从 device_states 恢复 ${rows.length} 台设备的上次状态`, {
          context: 'DeviceStatusService',
        });
      }
    } catch (err) {
      // 表还没建好(首次上线迁移前)或读失败: 退化成纯内存行为, 不影响启动
      this.logger.warn(`恢复设备状态失败(退化为内存态): ${(err as Error).message}`, {
        context: 'DeviceStatusService',
      });
    }
  }

  /** 过期的 'running' 回落成 'online'; 其余状态原样返回 */
  private decayRunning(snap: DeviceStatusSnapshot): DeviceStatusSnapshot {
    if (snap.status !== 'running') return snap;
    if (!Number.isFinite(this.runningTtlMs) || this.runningTtlMs <= 0) return snap;
    const age = Date.now() - Date.parse(snap.updatedAt);
    if (!Number.isFinite(age) || age < this.runningTtlMs) return snap;
    return { ...snap, status: 'online' };
  }

  get(deviceName: string): DeviceStatusSnapshot | undefined {
    const snap = this.cache.get(deviceName);
    return snap ? this.decayRunning(snap) : undefined;
  }

  list(): DeviceStatusSnapshot[] {
    return Array.from(this.cache.values()).map((snap) => this.decayRunning(snap));
  }

  async update(
    deviceName: string,
    status: DeviceStatus,
    state: Record<string, unknown> = {},
    persist = false,
  ): Promise<DeviceStatusSnapshot> {
    const prev = this.cache.get(deviceName);
    const snapshot: DeviceStatusSnapshot = {
      device: deviceName,
      status,
      state,
      updatedAt: new Date().toISOString(),
    };
    this.cache.set(deviceName, snapshot);

    this.bus.publish({
      type: 'device_status',
      device: deviceName,
      status,
      state,
      at: snapshot.updatedAt,
    });

    // 持久化到 device_states —— fire-and-forget, 绝不阻塞控制热路径。
    // 只在**状态转换**或**命令类更新**时落库, 不然健康检查每几秒对每台设备写一次,
    // 纯写放大且没有价值(状态没变, 重启后从设备重新读也一样)。
    const isCommand = state != null && typeof state === 'object' && 'lastCommand' in state;
    if (!prev || prev.status !== status || isCommand) {
      void this.persistState(deviceName, status, state, isCommand);
    }

    if (persist) {
      try {
        await this.deviceRepo.update({ name: deviceName }, { status });
      } catch (err) {
        this.logger.warn(
          `Persist status for ${deviceName} failed: ${(err as Error).message}`,
          { context: 'DeviceStatusService' },
        );
      }
    }

    return snapshot;
  }

  /**
   * upsert 一行设备状态。命令类更新额外记 lastCommandAt / lastCommandResult;
   * 非命令更新只带 status/state/updatedAt 三列 —— upsert 不覆盖没提供的列, 所以
   * 一次健康检查不会把上一次的命令记录冲掉。
   */
  private async persistState(
    deviceName: string,
    status: DeviceStatus,
    state: Record<string, unknown>,
    isCommand: boolean,
  ): Promise<void> {
    try {
      const row: Partial<DeviceState> = {
        deviceName,
        status,
        state: JSON.stringify(state ?? {}),
        updatedAt: new Date(),
      };
      if (isCommand) {
        row.lastCommandAt = new Date();
        row.lastCommandResult = JSON.stringify({
          command: (state as { lastCommand?: unknown }).lastCommand ?? null,
          result: (state as { lastResult?: unknown }).lastResult ?? null,
          error: (state as { error?: unknown }).error ?? null,
        });
      }
      await this.stateRepo.upsert(row as DeviceState, ['deviceName']);
    } catch (err) {
      this.logger.warn(`persist device_state 失败 (${deviceName}): ${(err as Error).message}`, {
        context: 'DeviceStatusService',
      });
    }
  }

  pushAlarm(source: string, level: 'info' | 'warning' | 'error', message: string): void {
    this.bus.publish({
      type: 'alarm',
      source,
      level,
      message,
      at: new Date().toISOString(),
    });
  }
}
