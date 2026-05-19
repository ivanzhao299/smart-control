import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { MockDaliAdapter, BrightnessState } from './mock-dali.adapter';
import { RealDaliAdapter } from './real-dali.adapter';

@Injectable()
export class LightingAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'lighting';
  }

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockDaliAdapter,
    private readonly realImpl: RealDaliAdapter,
  ) {
    super(config, logger);
    this.logger.info(
      `LightingAdapter ready (mode=${this.isMock() ? 'mock' : 'real-dali'})`,
      { context: 'LightingAdapter' },
    );
  }

  private impl(): MockDaliAdapter | RealDaliAdapter {
    return this.isMock() ? this.mockImpl : this.realImpl;
  }

  turnOn(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().turnOn(deviceId, params, ctx);
  }

  turnOff(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().turnOff(deviceId, params, ctx);
  }

  setBrightness(deviceId: string, params: { value?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().setBrightness(deviceId, params, ctx);
  }

  recallScene(deviceId: string, params: { scene?: string | number } = {}, ctx?: AdapterContext): Promise<AdapterResult<{ scene: string | number }>> {
    return this.impl().recallScene(deviceId, params, ctx);
  }

  getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().getStatus(deviceId, ctx);
  }

  setZoneBrightness(zoneId: number, value: number, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState & { zone: number }>> {
    return this.impl().setZoneBrightness(zoneId, value, ctx);
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    if (this.isMock()) return this.mockImpl.healthCheck(ctx);
    return this.realImpl.healthCheck(ctx);
  }
}
