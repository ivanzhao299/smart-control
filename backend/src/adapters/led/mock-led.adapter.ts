import { Injectable } from '@nestjs/common';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export type LedInput = 'HDMI1' | 'HDMI2' | 'welcome' | 'video';

export interface LedState {
  power: boolean;
  input: LedInput;
  media: string | null;
}

@Injectable()
export class MockLedAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'led';
  }

  private state = new Map<string, LedState>();

  private get(deviceId: string): LedState {
    const cur = this.state.get(deviceId);
    if (cur) return cur;
    const fresh: LedState = { power: false, input: 'HDMI1', media: null };
    this.state.set(deviceId, fresh);
    return fresh;
  }

  async powerOn(deviceId: string, _params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOn', ctx, async () => {
      const s = this.get(deviceId);
      s.power = true;
      return s;
    });
  }

  async powerOff(deviceId: string, _params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOff', ctx, async () => {
      const s = this.get(deviceId);
      s.power = false;
      s.media = null;
      return s;
    });
  }

  async switchInput(deviceId: string, params: { input?: LedInput } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'switchInput', ctx, async () => {
      const allowed: LedInput[] = ['HDMI1', 'HDMI2', 'welcome', 'video'];
      const next = params.input ?? 'HDMI1';
      if (!allowed.includes(next)) throw new Error(`invalid led input: ${next}`);
      const s = this.get(deviceId);
      s.input = next;
      return s;
    });
  }

  async playMedia(deviceId: string, params: { media?: string; channel?: string } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'playMedia', ctx, async () => {
      const s = this.get(deviceId);
      s.power = true;
      s.media = params.media ?? params.channel ?? 'default';
      return s;
    });
  }

  async showWelcome(deviceId: string, _params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'showWelcome', ctx, async () => {
      const s = this.get(deviceId);
      s.power = true;
      s.input = 'welcome';
      s.media = 'welcome';
      return s;
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => this.get(deviceId));
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('led-mock-gateway', 'healthCheck', ctx, async () => ({ ok: true as const }));
  }
}
