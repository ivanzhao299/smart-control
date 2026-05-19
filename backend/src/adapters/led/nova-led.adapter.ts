import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { TcpClient } from '../transports/tcp-client';
import { HttpClient } from '../transports/http-client';
import { withRetry } from '../retry';
import { classifyError, DeviceProtocolError } from '../errors';
import { AdapterConnectionRegistry } from '../connection-registry';
import type { LedInput, LedState } from './mock-led.adapter';

const GATEWAY_KEY = 'led-nova-vx1000';

/**
 * 真实 LED 适配器 - 诺瓦 VX1000 + Intel NUC 播控主机。
 *
 * 通讯模式 (LED_TRANSPORT, 默认 tcp):
 *   - tcp:  发送 ASCII 文本指令到 NUC 播控主机控制端口
 *           指令格式: <CMD> [args]\n   返回: OK / ERR ...
 *           CMD ∈ POWER_ON | POWER_OFF | INPUT <HDMI1|HDMI2|welcome|video> | PLAY <name> | STATUS
 *   - http: 播控主机暴露 REST API (POST /api/power, /api/input, /api/play, GET /api/status)
 */
@Injectable()
export class NovaLedAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'led';
  }

  private readonly transport: 'tcp' | 'http';
  private readonly host: string;
  private readonly port: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly tcp?: TcpClient;
  private readonly http?: HttpClient;
  private readonly endpoint: string;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
  ) {
    super(config, logger);
    this.host = process.env.LED_HOST ?? '192.168.50.30';
    this.port = Number.parseInt(process.env.LED_PORT ?? '5200', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
    this.transport = (process.env.LED_TRANSPORT === 'http' ? 'http' : 'tcp') as 'tcp' | 'http';
    this.endpoint = `${this.transport}://${this.host}:${this.port}`;

    if (this.transport === 'http') {
      this.http = new HttpClient({
        baseUrl: `http://${this.host}:${this.port}`,
        deviceType: 'led',
        timeoutMs: this.timeoutMs,
        retries: this.retries,
      });
    } else {
      this.tcp = new TcpClient({
        host: this.host,
        port: this.port,
        deviceType: 'led',
        timeoutMs: this.timeoutMs,
      });
    }
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      if (this.http) {
        await this.http.request({ method: 'GET', path: '/api/status' }, ctx?.signal);
      } else {
        await this.tcp!.ping(this.timeoutMs, ctx?.signal);
      }
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('led', err);
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

  async powerOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOn', ctx, async () => this.sendCommand('POWER_ON', {}, ctx));
  }

  async powerOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOff', ctx, async () => this.sendCommand('POWER_OFF', {}, ctx));
  }

  async switchInput(deviceId: string, params: { input?: LedInput } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'switchInput', ctx, async () => {
      const allowed: LedInput[] = ['HDMI1', 'HDMI2', 'welcome', 'video'];
      const next = params.input ?? 'HDMI1';
      if (!allowed.includes(next)) throw new DeviceProtocolError('led', `invalid input: ${next}`);
      return this.sendCommand('INPUT', { value: next }, ctx);
    });
  }

  async playMedia(deviceId: string, params: { media?: string; channel?: string } = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'playMedia', ctx, async () => {
      const name = params.media ?? params.channel ?? 'default';
      return this.sendCommand('PLAY', { value: name }, ctx);
    });
  }

  async showWelcome(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'showWelcome', ctx, async () => this.sendCommand('INPUT', { value: 'welcome' }, ctx));
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => this.sendCommand('STATUS', {}, ctx));
  }

  private async sendCommand(
    cmd: 'POWER_ON' | 'POWER_OFF' | 'INPUT' | 'PLAY' | 'STATUS',
    params: { value?: string },
    ctx?: AdapterContext,
  ): Promise<LedState> {
    const result = await withRetry(
      async () => {
        if (this.http) return this.callHttp(cmd, params, ctx?.signal);
        return this.callTcp(cmd, params, ctx?.signal);
      },
      { retries: this.retries, timeoutMs: this.timeoutMs, signal: ctx?.signal },
    ).catch((err) => {
      const dErr = classifyError('led', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    });

    this.registry.markOnline(GATEWAY_KEY);
    return result;
  }

  private async callHttp(
    cmd: string,
    params: { value?: string },
    signal?: AbortSignal,
  ): Promise<LedState> {
    if (cmd === 'STATUS') {
      const res = await this.http!.request<Partial<LedState>>(
        { method: 'GET', path: '/api/status' },
        signal,
      );
      return this.normalize(res.data);
    }
    const path =
      cmd === 'POWER_ON' || cmd === 'POWER_OFF'
        ? '/api/power'
        : cmd === 'INPUT'
          ? '/api/input'
          : '/api/play';
    const body =
      cmd === 'POWER_ON'
        ? { on: true }
        : cmd === 'POWER_OFF'
          ? { on: false }
          : cmd === 'INPUT'
            ? { input: params.value }
            : { media: params.value };
    const res = await this.http!.request<Partial<LedState>>(
      { method: 'POST', path, body },
      signal,
    );
    return this.normalize(res.data);
  }

  private async callTcp(
    cmd: string,
    params: { value?: string },
    signal?: AbortSignal,
  ): Promise<LedState> {
    const text = params.value ? `${cmd} ${params.value}\n` : `${cmd}\n`;
    const resp = await this.tcp!.sendAndExpect(Buffer.from(text, 'utf8'), 64, signal);
    const reply = resp.toString('utf8').trim();
    if (/^ERR/i.test(reply)) {
      throw new DeviceProtocolError('led', `device replied: ${reply}`);
    }
    return this.parseTcpReply(reply, cmd, params);
  }

  private parseTcpReply(
    reply: string,
    cmd: string,
    params: { value?: string },
  ): LedState {
    // 期望: OK power=1 input=HDMI1 media=welcome
    const kv: Record<string, string> = {};
    for (const part of reply.replace(/^OK\s*/i, '').split(/\s+/)) {
      const [k, v] = part.split('=');
      if (k && v !== undefined) kv[k] = v;
    }
    const power = kv.power
      ? kv.power === '1' || kv.power.toLowerCase() === 'on'
      : cmd === 'POWER_ON' || cmd === 'PLAY' || cmd === 'INPUT';
    const input = (kv.input as LedInput) ?? (cmd === 'INPUT' ? (params.value as LedInput) : 'HDMI1');
    const media = kv.media ?? (cmd === 'PLAY' ? params.value ?? null : null);
    return { power, input, media: media === '' ? null : media };
  }

  private normalize(s: Partial<LedState> | undefined): LedState {
    return {
      power: Boolean(s?.power ?? false),
      input: (s?.input as LedInput) ?? 'HDMI1',
      media: s?.media ?? null,
    };
  }
}
