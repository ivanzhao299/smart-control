import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { LedInput, LedState, MockLedAdapter } from './mock-led.adapter';
import { NovaLedAdapter } from './nova-led.adapter';

@Injectable()
export class LedAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'led';
  }

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockLedAdapter,
    private readonly realImpl: NovaLedAdapter,
  ) {
    super(config, logger);
    this.logger.info(`LedAdapter ready (mode=${this.isMock() ? 'mock' : 'nova-vx1000'})`, {
      context: 'LedAdapter',
    });
  }

  private impl(): MockLedAdapter | NovaLedAdapter {
    return this.isMock() ? this.mockImpl : this.realImpl;
  }

  powerOn(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().powerOn(deviceId, params, ctx);
  }

  powerOff(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().powerOff(deviceId, params, ctx);
  }

  switchInput(deviceId: string, params: { input?: LedInput } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().switchInput(deviceId, params, ctx);
  }

  playMedia(deviceId: string, params: { media?: string; channel?: string } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().playMedia(deviceId, params, ctx);
  }

  showWelcome(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().showWelcome(deviceId, params, ctx);
  }

  getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.impl().getStatus(deviceId, ctx);
  }

  healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }
}
