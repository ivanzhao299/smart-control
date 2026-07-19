import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Device, DeviceStatus } from '../entities/device.entity';
import { ControlBus } from './control-bus';

export interface DeviceStatusSnapshot {
  device: string;
  status: DeviceStatus;
  state: Record<string, unknown>;
  updatedAt: string;
}

@Injectable()
export class DeviceStatusService {
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
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

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
