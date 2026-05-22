import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { AudioState, AudioZone, MockAudioAdapter } from './mock-audio.adapter';
import { RealAudioAdapter } from './real-audio.adapter';
import { EkxDspAdapter } from './ekx808.adapter';

type AudioVendor = 'dsppa' | 'takstar-ekx808';

@Injectable()
export class AudioAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'audio';
  }

  private readonly vendor: AudioVendor;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockAudioAdapter,
    private readonly realImpl: RealAudioAdapter,
    private readonly ekxImpl: EkxDspAdapter,
  ) {
    super(config, logger);
    this.vendor = (process.env.AUDIO_VENDOR as AudioVendor) || 'takstar-ekx808';
    this.logger.info(
      `AudioAdapter ready (mode=${this.isMock() ? 'mock' : `live:${this.vendor}`})`,
      { context: 'AudioAdapter' },
    );
  }

  private impl(): MockAudioAdapter | RealAudioAdapter | EkxDspAdapter {
    if (this.isMock()) return this.mockImpl;
    return this.vendor === 'takstar-ekx808' ? this.ekxImpl : this.realImpl;
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

  // ============ EKX-808 专属: 场景预设 (其它厂家用 mock 返回 ok) ============

  /** 一键场景切换: 调用 EKX-808 用户预设 U01-U12 */
  async recallScene(presetNum: number, ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    if (this.isMock()) {
      return {
        ok: true, deviceId: 'audio-dsp', command: `recallScene_U${presetNum}`,
        data: { preset: presetNum }, mock: true, durationMs: 0,
      };
    }
    if (this.vendor === 'takstar-ekx808') return this.ekxImpl.recallScene(presetNum, ctx);
    return {
      ok: false, deviceId: 'audio-dsp', command: `recallScene_U${presetNum}`,
      error: `recallScene 仅 takstar-ekx808 厂家支持, 当前 vendor=${this.vendor}`,
      mock: false, durationMs: 0,
    };
  }

  /** 读当前激活的场景号 (返回 0=F00, 1-12=U01-U12) */
  async readCurrentScene(ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    if (this.isMock()) {
      return { ok: true, deviceId: 'audio-dsp', command: 'readCurrentScene', data: { preset: 2 }, mock: true, durationMs: 0 };
    }
    if (this.vendor === 'takstar-ekx808') return this.ekxImpl.readCurrentScene(ctx);
    return {
      ok: false, deviceId: 'audio-dsp', command: 'readCurrentScene',
      error: `readCurrentScene 仅 takstar-ekx808 厂家支持`,
      mock: false, durationMs: 0,
    };
  }
}
