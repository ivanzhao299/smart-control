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

  turnOn(
    deviceId: string,
    params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.impl().turnOn(deviceId, params, ctx);
  }

  turnOff(
    deviceId: string,
    params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.impl().turnOff(deviceId, params, ctx);
  }

  setTemperature(
    deviceId: string,
    params: { value?: number; temperature?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.impl().setTemperature(deviceId, params, ctx);
  }

  setMode(
    deviceId: string,
    params: { mode?: HvacMode } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.impl().setMode(deviceId, params, ctx);
  }

  setFanSpeed(
    deviceId: string,
    params: { speed?: FanSpeed } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<HvacState>> {
    return this.impl().setFanSpeed(deviceId, params, ctx);
  }

  getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.impl().getStatus(deviceId, ctx);
  }

  /**
   * 批量读所有内机真实状态 (PWA 空调页轮询用).
   *
   * 真机走 ModbusHvacAdapter.readAllStates() —— 按网关合并成一次 Modbus 读.
   * mock 模式没有"所有内机"的概念 (它的 key 是随便传进来的 deviceId), 所以
   * 由调用方给出内机序号清单, 逐个问 mock 拿。mock 是内存操作, 逐个也不慢。
   */
  async readAllStates(
    indoorIdxs: number[],
    ctx?: AdapterContext,
  ): Promise<Map<number, HvacState & { online: boolean; faultCode?: number }>> {
    if (!this.isMock()) return this.realImpl.readAllStates(ctx?.signal);
    const out = new Map<number, HvacState & { online: boolean; faultCode?: number }>();
    for (const idx of indoorIdxs) {
      const r = await this.mockImpl.getStatus(String(idx), ctx);
      if (r.ok && r.data) out.set(idx, { ...r.data, online: true });
    }
    return out;
  }

  healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }
}
