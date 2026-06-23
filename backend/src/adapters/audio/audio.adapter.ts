import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { AudioState, AudioZone, MockAudioAdapter } from './mock-audio.adapter';
import { RealAudioAdapter } from './real-audio.adapter';
import { EkxDspAdapter, type SceneContent } from './ekx808.adapter';
import type { ChannelIndex } from './ekx808-protocol';

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

  /**
   * 下发后台编辑的场景内容 (矩阵路由 + 音量 + 静音) 到 DSP.
   * 跟 recallScene 不同: 这个内容存在我们 DB 里, 业主后台可改, 不依赖设备内置预设.
   */
  async applyScene(content: SceneContent, ctx?: AdapterContext): Promise<AdapterResult<{ commands: number; outputs: number }>> {
    if (this.isMock()) {
      return {
        ok: true, deviceId: 'audio-dsp', command: 'applyScene',
        data: { commands: 0, outputs: content?.outputs?.length ?? 0 }, mock: true, durationMs: 0,
      };
    }
    if (this.vendor === 'takstar-ekx808') return this.ekxImpl.applyScene(content, ctx);
    return {
      ok: false, deviceId: 'audio-dsp', command: 'applyScene',
      error: `applyScene 仅 takstar-ekx808 厂家支持, 当前 vendor=${this.vendor}`,
      mock: false, durationMs: 0,
    };
  }

  /** 清空场景增量缓存 → 下次 applyScene 全量下发 (mock / 非 ekx 直接 no-op) */
  resetSceneCache(): void {
    if (!this.isMock() && this.vendor === 'takstar-ekx808') this.ekxImpl.resetSceneCache();
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

  /**
   * 实时设置矩阵单点路由 (Out X ← In Y 开/关). 前台"音源矩阵"页 / 调试 808 用.
   * ekxImpl.setMatrix 内部会同步增量缓存, 不跟 applyScene 打架.
   */
  async setMatrix(out: number, input: number, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ out: number; input: number; on: boolean }>> {
    if (this.isMock()) {
      return { ok: true, deviceId: 'audio-dsp', command: 'setMatrix', data: { out, input, on }, mock: true, durationMs: 0 };
    }
    if (this.vendor === 'takstar-ekx808') {
      return this.ekxImpl.setMatrix(out as ChannelIndex, input as ChannelIndex, on, ctx);
    }
    return {
      ok: false, deviceId: 'audio-dsp', command: 'setMatrix',
      error: `setMatrix 仅 takstar-ekx808 厂家支持, 当前 vendor=${this.vendor}`,
      mock: false, durationMs: 0,
    };
  }

  /** 设置输入通道增益 (0-100%). 前台音源矩阵输入增益滑条用. */
  async setInputVolume(channel: number, percent: number, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; volume: number }>> {
    if (this.isMock()) {
      return { ok: true, deviceId: 'audio-dsp', command: 'setInputVolume', data: { channel, volume: percent }, mock: true, durationMs: 0 };
    }
    if (this.vendor === 'takstar-ekx808') {
      return this.ekxImpl.setInputVolume(channel as ChannelIndex, percent, ctx);
    }
    return {
      ok: false, deviceId: 'audio-dsp', command: 'setInputVolume',
      error: `setInputVolume 仅 takstar-ekx808 厂家支持, 当前 vendor=${this.vendor}`,
      mock: false, durationMs: 0,
    };
  }

  /**
   * 调试: 发任意 hex frame 到 EKX, 拿原始响应字节.
   * 用于协议排查 — 业主在 PC 软件里改一个值后, 我们读回看 raw bytes,
   * 跟说明书对比找出 backend 解析的偏移错误.
   */
  async debugSendRaw(hex: string): Promise<{ sent: string; received: string; receivedBytes: number }> {
    if (this.vendor !== 'takstar-ekx808') {
      throw new Error('debugSendRaw 仅 takstar-ekx808 厂家支持');
    }
    return this.ekxImpl.debugSendRaw(hex);
  }

  async debugSendUdp(hex: string, host: string, port: number, timeoutMs: number): Promise<{ sent: string; received: string; receivedBytes: number; from?: string }> {
    if (this.vendor !== 'takstar-ekx808') {
      throw new Error('debugSendUdp 仅 takstar-ekx808 厂家支持');
    }
    return this.ekxImpl.debugSendUdp(hex, host, port, timeoutMs);
  }
}
