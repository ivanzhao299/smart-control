import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HttpClient } from '../transports/http-client';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError } from '../errors';
import type { BrightnessState } from './mock-dali.adapter';

const GATEWAY_KEY = 'lighting-dali-gateway';

interface DaliAddressing {
  address?: number;
  zone?: number;
  group?: number;
}

/**
 * 真实 DALI-2 适配器 - 通过 DALI IoT Gateway 的 HTTP REST API 控制。
 *
 * 期望网关接口 (可由 .env 改写):
 *   PUT  /control/<scope>/<id>/level    {"level":0..100}
 *   POST /control/<scope>/<id>/on
 *   POST /control/<scope>/<id>/off
 *   POST /control/<scope>/<id>/scene    {"scene":N}
 *   GET  /control/<scope>/<id>          -> {"level":N,"on":bool}
 *   GET  /health                        -> {"status":"ok"}
 *
 * scope ∈ { address, zone, group }
 *
 * 设备 address 字段编码 DALI 寻址，例如:
 *   {"address": 5}    单灯短地址 5
 *   {"zone": 2}       区域 2
 *   {"group": 1}      分组 1
 */
@Injectable()
export class RealDaliAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'lighting';
  }

  private readonly http: HttpClient;
  private readonly endpoint: string;
  private readonly daliConfig: {
    host: string;
    port: number;
    apiPath: string;
    apiKey?: string;
    timeoutMs: number;
    retries: number;
  };

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
  ) {
    super(config, logger);
    this.daliConfig = {
      host: process.env.DALI_GATEWAY_HOST ?? '192.168.77.20',
      port: Number.parseInt(process.env.DALI_GATEWAY_PORT ?? '80', 10),
      apiPath: process.env.DALI_API_PATH ?? '/control',
      apiKey: process.env.DALI_API_KEY,
      timeoutMs: Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10),
      retries: Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10),
    };
    const cfg = this.daliConfig;
    this.endpoint = `http://${cfg.host}:${cfg.port}`;
    this.http = new HttpClient({
      baseUrl: this.endpoint,
      deviceType: 'lighting',
      timeoutMs: cfg.timeoutMs,
      retries: cfg.retries,
      authHeader: cfg.apiKey ? `Bearer ${cfg.apiKey}` : undefined,
    });
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      await this.http.request({ method: 'GET', path: '/health' }, ctx?.signal);
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, false);
      throw dErr;
    }
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      await this.ping(ctx);
      return { ok: true as const };
    });
  }

  async turnOn(
    deviceId: string,
    params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.callCommand(deviceId, 'turnOn', params, ctx, async (scope, id) => {
      await this.invoke(
        { method: 'POST', path: `${this.daliConfig.apiPath}/${scope}/${id}/on` },
        ctx?.signal,
      );
      const result = await this.readState(scope, id, ctx?.signal);
      return { brightness: result.level, on: true };
    });
  }

  async turnOff(
    deviceId: string,
    params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.callCommand(deviceId, 'turnOff', params, ctx, async (scope, id) => {
      await this.invoke(
        { method: 'POST', path: `${this.daliConfig.apiPath}/${scope}/${id}/off` },
        ctx?.signal,
      );
      return { brightness: 0, on: false };
    });
  }

  async setBrightness(
    deviceId: string,
    params: { value?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.callCommand(deviceId, 'setBrightness', params, ctx, async (scope, id) => {
      const value = Math.max(0, Math.min(100, Number(params.value ?? 0)));
      await this.invoke(
        {
          method: 'PUT',
          path: `${this.daliConfig.apiPath}/${scope}/${id}/level`,
          body: { level: value },
        },
        ctx?.signal,
      );
      return { brightness: value, on: value > 0 };
    });
  }

  async recallScene(
    deviceId: string,
    params: { scene?: string | number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ scene: string | number }>> {
    return this.callCommand(deviceId, 'recallScene', params, ctx, async (scope, id) => {
      const scene = params.scene ?? 0;
      await this.invoke(
        {
          method: 'POST',
          path: `${this.daliConfig.apiPath}/${scope}/${id}/scene`,
          body: { scene },
        },
        ctx?.signal,
      );
      return { scene };
    });
  }

  async getStatus(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState>> {
    return this.callCommand(deviceId, 'getStatus', {}, ctx, async (scope, id) => {
      const s = await this.readState(scope, id, ctx?.signal);
      return { brightness: s.level, on: s.on };
    });
  }

  async setZoneBrightness(
    zoneId: number,
    value: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState & { zone: number }>> {
    return this.run(`zone-${zoneId}`, 'setZoneBrightness', ctx, async () => {
      const v = Math.max(0, Math.min(100, Number(value)));
      await this.invoke(
        {
          method: 'PUT',
          path: `${this.daliConfig.apiPath}/zone/${zoneId}/level`,
          body: { level: v },
        },
        ctx?.signal,
      );
      return { brightness: v, on: v > 0, zone: zoneId };
    });
  }

  private async callCommand<T>(
    deviceId: string,
    command: string,
    params: Record<string, unknown>,
    ctx: AdapterContext | undefined,
    fn: (scope: 'address' | 'zone' | 'group', id: number) => Promise<T>,
  ): Promise<AdapterResult<T>> {
    return this.run(deviceId, command, ctx, async () => {
      const target = this.parseAddressing(params, deviceId);
      return fn(target.scope, target.id);
    });
  }

  private async invoke(
    req: { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown },
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      const res = await this.http.request({ ...req }, signal);
      this.registry.markOnline(GATEWAY_KEY);
      return res.data;
    } catch (err) {
      const dErr = classifyError('lighting', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async readState(
    scope: 'address' | 'zone' | 'group',
    id: number,
    signal?: AbortSignal,
  ): Promise<{ level: number; on: boolean }> {
    const res = (await this.invoke(
      { method: 'GET', path: `${this.daliConfig.apiPath}/${scope}/${id}` },
      signal,
    )) as { level?: number; on?: boolean } | undefined;
    const level = Math.max(0, Math.min(100, Number(res?.level ?? 0)));
    return { level, on: Boolean(res?.on ?? level > 0) };
  }

  private parseAddressing(
    params: Record<string, unknown>,
    deviceId: string,
  ): { scope: 'address' | 'zone' | 'group'; id: number } {
    const candidates: DaliAddressing[] = [params as DaliAddressing];
    try {
      const fromId = JSON.parse(deviceId) as DaliAddressing;
      candidates.push(fromId);
    } catch {
      // deviceId 不是 JSON, 忽略
    }
    for (const c of candidates) {
      if (typeof c.address === 'number') return { scope: 'address', id: c.address };
      if (typeof c.zone === 'number') return { scope: 'zone', id: c.zone };
      if (typeof c.group === 'number') return { scope: 'group', id: c.group };
    }
    return { scope: 'zone', id: 1 };
  }
}
