import { Injectable } from '@nestjs/common';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export interface PowerState {
  on: boolean;
}

@Injectable()
export class PowerAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private state = new Map<string, PowerState>();

  async turnOn(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      this.ensureMockOrThrow('turnOn');
      const s: PowerState = { on: true };
      this.state.set(deviceId, s);
      return s;
    });
  }

  async turnOff(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      this.ensureMockOrThrow('turnOff');
      const s: PowerState = { on: false };
      this.state.set(deviceId, s);
      return s;
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      this.ensureMockOrThrow('getStatus');
      return this.state.get(deviceId) ?? { on: false };
    });
  }
}
