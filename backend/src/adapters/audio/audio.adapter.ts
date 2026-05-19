import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { AudioState, AudioZone, MockAudioAdapter } from './mock-audio.adapter';
import { RealAudioAdapter } from './real-audio.adapter';

@Injectable()
export class AudioAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'audio';
  }

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockAudioAdapter,
    private readonly realImpl: RealAudioAdapter,
  ) {
    super(config, logger);
    this.logger.info(`AudioAdapter ready (mode=${this.isMock() ? 'mock' : 'dsppa-itc'})`, {
      context: 'AudioAdapter',
    });
  }

  private impl(): MockAudioAdapter | RealAudioAdapter {
    return this.isMock() ? this.mockImpl : this.realImpl;
  }

  setVolume(deviceId: string, params: { value?: number; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().setVolume(deviceId, params, ctx);
  }

  mute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().mute(deviceId, params, ctx);
  }

  unmute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().unmute(deviceId, params, ctx);
  }

  playBgm(deviceId: string, params: { track?: string; channel?: string; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().playBgm(deviceId, params, ctx);
  }

  stopBgm(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().stopBgm(deviceId, params, ctx);
  }

  enableMic(deviceId: string, params: { enable?: boolean; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.impl().enableMic(deviceId, params, ctx);
  }

  healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }
}
