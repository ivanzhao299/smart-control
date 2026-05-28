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
    const cur = this.state.get(gateway);
    if (cur) {
      // 已注册 — 如果 endpoint 变了 (后台改 IP 触发 adapter rewire), 更新 + 清旧错误
      if (cur.endpoint !== endpoint) {
        this.logger.info(
          `Gateway endpoint updated: ${gateway} ${cur.endpoint} → ${endpoint}, 清旧 lastError`,
          { context: 'ConnectionRegistry' },
        );
        cur.endpoint = endpoint;
        cur.lastError = undefined;
        cur.attempts = 0;
        // 状态保持原值, 等下一次 markOnline / markFailure 决定
        cur.updatedAt = new Date().toISOString();
        this.publish(cur);
      }
      return;
    }
    this.state.set(gateway, {
      gateway,
      state: 'offline',
      endpoint,
      attempts: 0,
      updatedAt: new Date().toISOString(),
    });
  }

  /** 强制清空所有网关的 lastError + 重置 attempts (后台"清空告警"按钮调). 状态保持. */
  clearAllFaults(): number {
    let cleared = 0;
    for (const info of this.state.values()) {
      if (info.lastError || info.attempts > 0) {
        info.lastError = undefined;
        info.attempts = 0;
        info.updatedAt = new Date().toISOString();
        this.publish(info);
        cleared += 1;
      }
    }
    if (cleared > 0) {
      this.logger.info(`Cleared lastError on ${cleared} gateways`, { context: 'ConnectionRegistry' });
    }
    return cleared;
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
      // 只在从 online 掉下来时推顶部 alarm — 持久离线设备 (从没上线过 / 一直
      // 在 offline ↔ reconnecting 之间打转) 不再刷红条, 状态栏里看就行
      if (prev === 'online') {
        this.bus.publish({
          type: 'alarm',
          source: gateway,
          level: 'warning',
          message: `${gateway} ${cur.state}: ${error}`,
          at: new Date().toISOString(),
        });
      }
    }
  }

  markError(gateway: string, error: string): void {
    const cur = this.state.get(gateway);
    if (!cur) return;
    const prev = cur.state;
    cur.state = 'error';
    cur.lastError = error;
    cur.updatedAt = new Date().toISOString();
    this.logger.error(`Gateway error: ${gateway} -> ${error}`, {
      context: 'ConnectionRegistry',
    });
    this.publish(cur);
    // 同 markFailure: 只在第一次从 online 掉到 error 时推顶部 alarm
    if (prev === 'online') {
      this.bus.publish({
        type: 'alarm',
        source: gateway,
        level: 'error',
        message: `${gateway} error: ${error}`,
        at: new Date().toISOString(),
      });
    }
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
