import { Injectable } from '@nestjs/common';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export type AudioZone = '1f_bg' | '2f_bg' | 'meeting' | 'roadshow' | string;

export interface AudioState {
  volume: number;
  muted: boolean;
  bgm: string | null;
  micEnabled: boolean;
}

@Injectable()
export class MockAudioAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'audio';
  }

  private state = new Map<string, AudioState>();

  private key(deviceId: string, zone?: AudioZone): string {
    return zone ? `${deviceId}#${zone}` : deviceId;
  }

  private get(deviceId: string, zone?: AudioZone): AudioState {
    const k = this.key(deviceId, zone);
    const cur = this.state.get(k);
    if (cur) return cur;
    const fresh: AudioState = { volume: 30, muted: false, bgm: null, micEnabled: false };
    this.state.set(k, fresh);
    return fresh;
  }

  async setVolume(deviceId: string, params: { value?: number; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'setVolume', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.volume = Math.max(0, Math.min(100, Number(params.value ?? s.volume)));
      return s;
    });
  }

  async mute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'mute', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.muted = true;
      return s;
    });
  }

  async unmute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'unmute', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.muted = false;
      return s;
    });
  }

  async playBgm(deviceId: string, params: { track?: string; channel?: string; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'playBgm', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.bgm = params.track ?? params.channel ?? 'default';
      s.muted = false;
      return s;
    });
  }

  async stopBgm(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'stopBgm', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.bgm = null;
      return s;
    });
  }

  async enableMic(deviceId: string, params: { enable?: boolean; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'enableMic', ctx, async () => {
      const s = this.get(deviceId, params.zone);
      s.micEnabled = params.enable !== false;
      return s;
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('audio-mock-gateway', 'healthCheck', ctx, async () => ({ ok: true as const }));
  }
}
