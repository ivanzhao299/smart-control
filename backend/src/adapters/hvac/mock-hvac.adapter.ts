import { Injectable } from '@nestjs/common';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export type HvacMode = 'cool' | 'heat' | 'fan' | 'auto' | 'dry';
export type FanSpeed = 'auto' | 'low' | 'mid' | 'high';

export interface HvacState {
  on: boolean;
  temperature: number;
  mode: HvacMode;
  fan: FanSpeed;
  roomTemp?: number;
}

@Injectable()
export class MockHvacAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'hvac';
  }

  private state = new Map<string, HvacState>();

  private get(deviceId: string): HvacState {
    const cur = this.state.get(deviceId);
    if (cur) return cur;
    const fresh: HvacState = { on: false, temperature: 24, mode: 'auto', fan: 'auto', roomTemp: 26 };
    this.state.set(deviceId, fresh);
    return fresh;
  }

  async turnOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const s = this.get(deviceId);
      s.on = true;
      return s;
    });
  }

  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const s = this.get(deviceId);
      s.on = false;
      return s;
    });
  }

  async setTemperature(deviceId: string, params: { value?: number; temperature?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setTemperature', ctx, async () => {
      // 兼容 spec 命名 ({temperature}) 与历史命名 ({value})
      const v = Number(params.value ?? params.temperature);
      if (!Number.isFinite(v) || v < 16 || v > 30) {
        throw new Error(`temperature out of range: ${v}`);
      }
      const s = this.get(deviceId);
      s.temperature = v;
      return s;
    });
  }

  async setMode(deviceId: string, params: { mode?: HvacMode } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setMode', ctx, async () => {
      const allowed: HvacMode[] = ['cool', 'heat', 'fan', 'auto', 'dry'];
      const mode = params.mode ?? 'auto';
      if (!allowed.includes(mode)) throw new Error(`invalid hvac mode: ${mode}`);
      const s = this.get(deviceId);
      s.mode = mode;
      return s;
    });
  }

  async setFanSpeed(deviceId: string, params: { speed?: FanSpeed } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setFanSpeed', ctx, async () => {
      const allowed: FanSpeed[] = ['auto', 'low', 'mid', 'high'];
      const speed = params.speed ?? 'auto';
      if (!allowed.includes(speed)) throw new Error(`invalid fan speed: ${speed}`);
      const s = this.get(deviceId);
      s.fan = speed;
      return s;
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => this.get(deviceId));
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('hvac-mock-gateway', 'healthCheck', ctx, async () => ({ ok: true as const }));
  }
}
