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

  constructor(
    @InjectRepository(Device) private readonly deviceRepo: Repository<Device>,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  get(deviceName: string): DeviceStatusSnapshot | undefined {
    return this.cache.get(deviceName);
  }

  list(): DeviceStatusSnapshot[] {
    return Array.from(this.cache.values());
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
