import { Injectable } from '@nestjs/common';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export interface BrightnessState {
  brightness: number;
  on: boolean;
}

/**
 * MOCK_MODE=true 时使用。内存中模拟一组灯具状态。
 */
@Injectable()
export class MockDaliAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'lighting';
  }

  private state = new Map<string, BrightnessState>();
  private zoneState = new Map<number, BrightnessState>();

  async turnOn(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const cur = this.state.get(deviceId) ?? { brightness: 0, on: false };
      cur.on = true;
      if (cur.brightness === 0) cur.brightness = 100;
      this.state.set(deviceId, cur);
      return cur;
    });
  }

  async turnOff(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const cur = this.state.get(deviceId) ?? { brightness: 0, on: false };
      cur.on = false;
      this.state.set(deviceId, cur);
      return cur;
    });
  }

  async setBrightness(
    deviceId: string,
    params: { value?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'setBrightness', ctx, async () => {
      const value = Math.max(0, Math.min(100, Number(params.value ?? 0)));
      const cur: BrightnessState = { brightness: value, on: value > 0 };
      this.state.set(deviceId, cur);
      return cur;
    });
  }

  async recallScene(
    deviceId: string,
    params: { scene?: string | number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ scene: string | number }>> {
    return this.run(deviceId, 'recallScene', ctx, async () => {
      const scene = params.scene ?? 'default';
      return { scene };
    });
  }

  async getStatus(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      return this.state.get(deviceId) ?? { brightness: 0, on: false };
    });
  }

  async setZoneBrightness(
    zoneId: number,
    value: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState & { zone: number }>> {
    return this.run(`zone-${zoneId}`, 'setZoneBrightness', ctx, async () => {
      const v = Math.max(0, Math.min(100, Number(value)));
      const cur: BrightnessState = { brightness: v, on: v > 0 };
      this.zoneState.set(zoneId, cur);
      return { ...cur, zone: zoneId };
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('lighting-mock-gateway', 'healthCheck', ctx, async () => ({ ok: true }));
  }
}
