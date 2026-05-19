import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ControlBus } from '../services/control-bus';

export type ConnectionState = 'online' | 'offline' | 'reconnecting' | 'error';

export interface ConnectionInfo {
  gateway: string;
  state: ConnectionState;
  endpoint: string;
  lastError?: string;
  attempts: number;
  updatedAt: string;
}

@Injectable()
export class AdapterConnectionRegistry {
  private readonly state = new Map<string, ConnectionInfo>();

  constructor(
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  register(gateway: string, endpoint: string): void {
    if (this.state.has(gateway)) return;
    this.state.set(gateway, {
      gateway,
      state: 'offline',
      endpoint,
      attempts: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  list(): ConnectionInfo[] {
    return Array.from(this.state.values());
  }

  get(gateway: string): ConnectionInfo | undefined {
    return this.state.get(gateway);
  }

  markOnline(gateway: string): void {
    const cur = this.state.get(gateway);
    if (!cur) return;
    const changed = cur.state !== 'online';
    cur.state = 'online';
    cur.lastError = undefined;
    cur.attempts = 0;
    cur.updatedAt = new Date().toISOString();
    if (changed) {
      this.logger.info(`Gateway online: ${gateway} (${cur.endpoint})`, {
        context: 'ConnectionRegistry',
      });
      this.publish(cur);
    }
  }

  markFailure(gateway: string, error: string, retrying: boolean): void {
    const cur = this.state.get(gateway);
    if (!cur) return;
    const prev = cur.state;
    cur.state = retrying ? 'reconnecting' : 'offline';
    cur.lastError = error;
    cur.attempts += 1;
    cur.updatedAt = new Date().toISOString();
    if (prev !== cur.state) {
      this.logger.warn(
        `Gateway ${cur.state}: ${gateway} (${cur.endpoint}) -> ${error}`,
        { context: 'ConnectionRegistry' },
      );
      this.publish(cur);
      this.bus.publish({
        type: 'alarm',
        source: gateway,
        level: 'warning',
        message: `${gateway} ${cur.state}: ${error}`,
        at: new Date().toISOString(),
      });
    }
  }

  markError(gateway: string, error: string): void {
    const cur = this.state.get(gateway);
    if (!cur) return;
    cur.state = 'error';
    cur.lastError = error;
    cur.updatedAt = new Date().toISOString();
    this.logger.error(`Gateway error: ${gateway} -> ${error}`, {
      context: 'ConnectionRegistry',
    });
    this.publish(cur);
    this.bus.publish({
      type: 'alarm',
      source: gateway,
      level: 'error',
      message: `${gateway} error: ${error}`,
      at: new Date().toISOString(),
    });
  }

  private publish(info: ConnectionInfo): void {
    this.bus.publish({
      type: 'device_status',
      device: info.gateway,
      status: info.state,
      state: { endpoint: info.endpoint, lastError: info.lastError ?? null, attempts: info.attempts },
      at: info.updatedAt,
    });
  }
}
