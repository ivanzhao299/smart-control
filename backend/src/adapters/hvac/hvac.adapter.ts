import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { FanSpeed, HvacMode, HvacState, MockHvacAdapter } from './mock-hvac.adapter';
import { ModbusHvacAdapter } from './modbus-hvac.adapter';

@Injectable()
export class HvacAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'hvac';
  }

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockHvacAdapter,
    private readonly realImpl: ModbusHvacAdapter,
  ) {
    super(config, logger);
    this.logger.info(`HvacAdapter ready (mode=${this.isMock() ? 'mock' : 'modbus-tcp'})`, {
      context: 'HvacAdapter',
    });
  }

  private impl(): MockHvacAdapter | ModbusHvacAdapter {
    return this.isMock() ? this.mockImpl : this.realImpl;
  }

  turnOn(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().turnOn(deviceId, params, ctx);
  }

  turnOff(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().turnOff(deviceId, params, ctx);
  }

  setTemperature(deviceId: string, params: { value?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().setTemperature(deviceId, params, ctx);
  }

  setMode(deviceId: string, params: { mode?: HvacMode } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().setMode(deviceId, params, ctx);
  }

  setFanSpeed(deviceId: string, params: { speed?: FanSpeed } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().setFanSpeed(deviceId, params, ctx);
  }

  getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().getStatus(deviceId, ctx);
  }

  healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }
}
