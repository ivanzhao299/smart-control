import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HttpClient } from '../transports/http-client';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError } from '../errors';
import { withRetry } from '../retry';
import type { AudioState, AudioZone } from './mock-audio.adapter';

const GATEWAY_KEY = 'audio-dsp';

/**
 * 真实音响适配器 - DSPPA / ITC 系列 DSP 矩阵。
 *
 * 通过 DSP 厂商 HTTP API 控制分区音量/静音/BGM/麦克风:
 *   PUT /api/zones/<zone>/volume   {value:0..100}
 *   POST /api/zones/<zone>/mute    {muted:bool}
 *   POST /api/zones/<zone>/source  {source:'bgm'|'mic'|'off', track?:string}
 *   GET  /api/zones/<zone>         -> AudioState
 *   GET  /api/health
 *
 * AUDIO_DEFAULT_ZONE 用于未在请求中显式给 zone 的情形。
 */
@Injectable()
export class RealAudioAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'audio';
  }

  private readonly http: HttpClient;
  private readonly endpoint: string;
  private readonly defaultZone: AudioZone;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
  ) {
    super(config, logger);
    const host = process.env.AUDIO_HOST ?? '192.168.50.40';
    const port = Number.parseInt(process.env.AUDIO_PORT ?? '80', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
    this.defaultZone = (process.env.AUDIO_DEFAULT_ZONE ?? '1f_bg') as AudioZone;
    this.endpoint = `http://${host}:${port}`;
    this.http = new HttpClient({
      baseUrl: this.endpoint,
      deviceType: 'audio',
      timeoutMs: this.timeoutMs,
      retries: this.retries,
      authHeader: process.env.AUDIO_API_KEY ? `Bearer ${process.env.AUDIO_API_KEY}` : undefined,
    });
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
  }

  private zoneFor(deviceId: string, params: { zone?: AudioZone } = {}): AudioZone {
    if (params.zone) return params.zone;
    const map: Record<string, AudioZone> = {
      audio_1f: '1f_bg',
      audio_2f: '2f_bg',
      audio_meeting: 'meeting',
      audio_roadshow: 'roadshow',
    };
    return map[deviceId] ?? this.defaultZone;
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      await this.http.request({ method: 'GET', path: '/api/health' }, ctx?.signal);
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('audio', err);
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

  async setVolume(deviceId: string, params: { value?: number; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'setVolume', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      const value = Math.max(0, Math.min(100, Number(params.value ?? 0)));
      await this.send({ method: 'PUT', path: `/api/zones/${zone}/volume`, body: { value } }, ctx?.signal);
      return this.readZone(zone, ctx?.signal);
    });
  }

  async mute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'mute', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      await this.send({ method: 'POST', path: `/api/zones/${zone}/mute`, body: { muted: true } }, ctx?.signal);
      return this.readZone(zone, ctx?.signal);
    });
  }

  async unmute(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'unmute', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      await this.send({ method: 'POST', path: `/api/zones/${zone}/mute`, body: { muted: false } }, ctx?.signal);
      return this.readZone(zone, ctx?.signal);
    });
  }

  async playBgm(deviceId: string, params: { track?: string; channel?: string; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'playBgm', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      const track = params.track ?? params.channel ?? 'default';
      await this.send(
        { method: 'POST', path: `/api/zones/${zone}/source`, body: { source: 'bgm', track } },
        ctx?.signal,
      );
      return this.readZone(zone, ctx?.signal);
    });
  }

  async stopBgm(deviceId: string, params: { zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'stopBgm', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      await this.send(
        { method: 'POST', path: `/api/zones/${zone}/source`, body: { source: 'off' } },
        ctx?.signal,
      );
      return this.readZone(zone, ctx?.signal);
    });
  }

  async enableMic(deviceId: string, params: { enable?: boolean; zone?: AudioZone } = {}, ctx?: AdapterContext): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'enableMic', ctx, async () => {
      const zone = this.zoneFor(deviceId, params);
      const source = params.enable === false ? 'off' : 'mic';
      await this.send(
        { method: 'POST', path: `/api/zones/${zone}/source`, body: { source } },
        ctx?.signal,
      );
      return this.readZone(zone, ctx?.signal);
    });
  }

  private async send(
    req: { method: 'GET' | 'POST' | 'PUT'; path: string; body?: unknown },
    signal?: AbortSignal,
  ): Promise<unknown> {
    try {
      const res = await withRetry(
        () => this.http.request(req, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(GATEWAY_KEY);
      return res.data;
    } catch (err) {
      const dErr = classifyError('audio', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async readZone(zone: AudioZone, signal?: AbortSignal): Promise<AudioState> {
    const raw = (await this.send({ method: 'GET', path: `/api/zones/${zone}` }, signal)) as
      | Partial<AudioState>
      | undefined;
    return {
      volume: Math.max(0, Math.min(100, Number(raw?.volume ?? 0))),
      muted: Boolean(raw?.muted ?? false),
      bgm: raw?.bgm ?? null,
      micEnabled: Boolean(raw?.micEnabled ?? false),
    };
  }
}
