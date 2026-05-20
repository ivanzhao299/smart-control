import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { TcpClient } from '../transports/tcp-client';
import { HttpClient } from '../transports/http-client';
import { classifyError, DeviceProtocolError } from '../errors';
import { AdapterConnectionRegistry } from '../connection-registry';
import type { LedInput, LedState } from './mock-led.adapter';
import {
  brightnessPctToRaw,
  frameBrightness,
  frameDisplayMode,
  frameLoadPreset,
  frameReadDeviceId,
  frameSetLayer,
  ledInputToAction,
  verifyResponse,
  VX_CARD_SLOT,
  VX_DISPLAY_MODE,
} from './nova-vx1000-protocol';

const GATEWAY_KEY = 'led-nova-vx1000';

/**
 * 真实 LED 适配器 — 诺瓦 NovaStar VX1000 (或 VX400/VX600 Pro/VX2000 Pro 同协议族).
 *
 * 协议: TCP:5200, 私有 hex 帧 (头 55 AA + body + 校验和 SUM_L SUM_H).
 *   - 来源: VX400 Control Protocol V1.0 (2022-12-22), 协议适用整个 VX 系列.
 *   - 帧 builder/校验在 nova-vx1000-protocol.ts.
 *
 * 关键映射 (项目 LedInput → VX1000 物理操作):
 *   - powerOn  → 显示模式 NORMAL  (0x03)
 *   - powerOff → 显示模式 BLACKOUT (0x05, 黑屏)
 *   - HDMI1    → 切换图层 1 输入到 HDMI1 (Source 0x11)
 *   - HDMI2    → 切换图层 1 输入到 HDMI2 (Source 0x12)
 *   - welcome  → 加载预设 LED_PRESET_WELCOME (默认 1)
 *   - video    → 加载预设 LED_PRESET_VIDEO   (默认 2)
 *
 * 媒体播放 (NUC 主机):
 *   VX1000 本身只是视频处理器, 不播放媒体文件. 真正播放视频/welcome 页面的是 Intel NUC,
 *   它通过 HDMI 输出给 VX1000. 若现场设置了 LED_NUC_HOST, playMedia 会再向 NUC 发命令
 *   切换素材; 若没设置, playMedia 退化成 "切到 video 预设".
 *
 * env:
 *   LED_HOST=192.168.50.30          VX1000 IP
 *   LED_PORT=5200                    VX1000 TCP 端口
 *   LED_NUC_HOST=192.168.50.31      NUC 媒体主机 IP (可选)
 *   LED_NUC_PORT=8080                NUC HTTP API 端口
 *   LED_RESOLUTION_WIDTH=1920        全屏图层宽
 *   LED_RESOLUTION_HEIGHT=1080       全屏图层高
 *   LED_PRESET_WELCOME=1             welcome 对应预设号 (1-10)
 *   LED_PRESET_VIDEO=2               video 对应预设号
 *   LED_DEFAULT_BRIGHTNESS_PCT=80    powerOn 后默认亮度
 */
@Injectable()
export class NovaLedAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'led';
  }

  private readonly tcp: TcpClient;
  private readonly nucHttp?: HttpClient;
  private readonly endpoint: string;
  private readonly cfg: {
    host: string;
    port: number;
    timeoutMs: number;
    retries: number;
    width: number;
    height: number;
    presetWelcome: number;
    presetVideo: number;
    defaultBrightnessPct: number;
    nucHost?: string;
    nucPort?: number;
  };

  /** 进程内状态缓存 (VX1000 协议没有原生 getStatus 等价 API, 用缓存回填) */
  private readonly state = new Map<string, LedState>();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
  ) {
    super(config, logger);
    const host = process.env.LED_HOST ?? '192.168.50.30';
    const port = Number.parseInt(process.env.LED_PORT ?? '5200', 10);
    const nucHost = process.env.LED_NUC_HOST;
    const nucPort = nucHost ? Number.parseInt(process.env.LED_NUC_PORT ?? '8080', 10) : undefined;
    this.cfg = {
      host,
      port,
      timeoutMs: Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10),
      retries: Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10),
      width: Number.parseInt(process.env.LED_RESOLUTION_WIDTH ?? '1920', 10),
      height: Number.parseInt(process.env.LED_RESOLUTION_HEIGHT ?? '1080', 10),
      presetWelcome: Number.parseInt(process.env.LED_PRESET_WELCOME ?? '1', 10),
      presetVideo: Number.parseInt(process.env.LED_PRESET_VIDEO ?? '2', 10),
      defaultBrightnessPct: Number.parseInt(process.env.LED_DEFAULT_BRIGHTNESS_PCT ?? '80', 10),
      nucHost,
      nucPort,
    };
    this.endpoint = `tcp://${host}:${port}`;

    this.tcp = new TcpClient({
      host,
      port,
      deviceType: 'led',
      timeoutMs: this.cfg.timeoutMs,
    });

    if (nucHost && nucPort) {
      this.nucHttp = new HttpClient({
        baseUrl: `http://${nucHost}:${nucPort}`,
        deviceType: 'led',
        timeoutMs: this.cfg.timeoutMs,
        retries: this.cfg.retries,
      });
    }

    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);

    this.logger.info(
      `NovaLedAdapter ready (VX1000=${host}:${port}` +
        (nucHost ? `, NUC=${nucHost}:${nucPort}` : ', no NUC') +
        `, ${this.cfg.width}x${this.cfg.height})`,
      { context: 'NovaLedAdapter' },
    );
  }

  // ============ 公共 API ============

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      const frame = frameReadDeviceId();
      // VX1000 ReadDeviceID 响应大约 22 字节
      await this.tcp.sendAndExpect(frame, 22, ctx?.signal);
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

  async powerOn(
    deviceId: string,
    params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOn', ctx, async () => {
      await this.sendVx(frameDisplayMode(VX_DISPLAY_MODE.NORMAL), ctx?.signal);
      const brightnessPct = typeof params.brightness === 'number'
        ? (params.brightness as number)
        : this.cfg.defaultBrightnessPct;
      await this.sendVx(frameBrightness(brightnessPctToRaw(brightnessPct)), ctx?.signal);
      return this.updateState(deviceId, { power: true });
    });
  }

  async powerOff(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'powerOff', ctx, async () => {
      await this.sendVx(frameDisplayMode(VX_DISPLAY_MODE.BLACKOUT), ctx?.signal);
      return this.updateState(deviceId, { power: false, media: null });
    });
  }

  async switchInput(
    deviceId: string,
    params: { input?: LedInput } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'switchInput', ctx, async () => {
      const allowed: LedInput[] = ['HDMI1', 'HDMI2', 'welcome', 'video'];
      const next = params.input ?? 'HDMI1';
      if (!allowed.includes(next)) {
        throw new DeviceProtocolError('led', `invalid input: ${next}`);
      }
      const action = ledInputToAction(next, {
        welcome: this.cfg.presetWelcome,
        video: this.cfg.presetVideo,
      });
      if (action.kind === 'layer') {
        const cardSlot =
          action.source === 0x11 ? VX_CARD_SLOT.HDMI1
          : action.source === 0x12 ? VX_CARD_SLOT.HDMI2
          : action.source === 0x30 ? VX_CARD_SLOT.SDI
          : VX_CARD_SLOT.DVI;
        await this.sendVx(
          frameSetLayer({
            layerNo: 1,
            source: action.source,
            cardSlot,
            width: this.cfg.width,
            height: this.cfg.height,
            startX: 0,
            startY: 0,
            priority: 0,
            opacity: 0x64,
            switchOn: true,
          }),
          ctx?.signal,
        );
      } else {
        await this.sendVx(frameLoadPreset(action.presetNumber), ctx?.signal);
      }
      return this.updateState(deviceId, { input: next, power: true });
    });
  }

  async playMedia(
    deviceId: string,
    params: { media?: string; channel?: string } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'playMedia', ctx, async () => {
      const name = params.media ?? params.channel ?? 'default';
      // 1) VX1000 切到 video 预设 (确保画面源是 NUC 那路 HDMI)
      await this.sendVx(frameLoadPreset(this.cfg.presetVideo), ctx?.signal);
      // 2) 若现场配了 NUC, 通知 NUC 播放指定文件; 否则只切预设
      if (this.nucHttp) {
        try {
          await this.nucHttp.request(
            { method: 'POST', path: '/api/play', body: { media: name } },
            ctx?.signal,
          );
        } catch (err) {
          this.logger.warn(
            `NUC playMedia 失败 (VX1000 预设已切): ${(err as Error).message}`,
            { context: 'NovaLedAdapter' },
          );
        }
      }
      return this.updateState(deviceId, { input: 'video', power: true, media: name });
    });
  }

  async showWelcome(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'showWelcome', ctx, async () => {
      await this.sendVx(frameLoadPreset(this.cfg.presetWelcome), ctx?.signal);
      if (this.nucHttp) {
        try {
          await this.nucHttp.request(
            { method: 'POST', path: '/api/play', body: { media: 'welcome' } },
            ctx?.signal,
          );
        } catch {
          /* 容忍 NUC 不在线 */
        }
      }
      return this.updateState(deviceId, { input: 'welcome', power: true, media: 'welcome' });
    });
  }

  async getStatus(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      // VX1000 的状态查询协议较复杂 (返回多输入源分辨率快照),
      // 这里以"探活 + 返回本地缓存"的策略:
      await this.ping(ctx);
      return this.getState(deviceId);
    });
  }

  /** 单独调亮度 (% 0-100), 不改其它状态 */
  async setBrightness(
    deviceId: string,
    params: { value?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'setBrightness', ctx, async () => {
      const pct = Math.max(0, Math.min(100, Number(params.value ?? 80)));
      await this.sendVx(frameBrightness(brightnessPctToRaw(pct)), ctx?.signal);
      return this.getState(deviceId);
    });
  }

  /** 直接切到预设 1-10 (高级用法, 配合现场调试软件预存的预设) */
  async loadPreset(
    deviceId: string,
    params: { preset?: number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<LedState>> {
    return this.run(deviceId, 'loadPreset', ctx, async () => {
      const n = Number(params.preset);
      if (!Number.isInteger(n) || n < 1 || n > 10) {
        throw new DeviceProtocolError('led', `preset 必须 1-10, got ${params.preset}`);
      }
      await this.sendVx(frameLoadPreset(n), ctx?.signal);
      return this.updateState(deviceId, { power: true });
    });
  }

  // ============ 内部工具 ============

  /** 发送一帧给 VX1000, 验证响应; 失败计入 registry */
  private async sendVx(frame: Buffer, signal?: AbortSignal): Promise<Buffer> {
    try {
      // VX1000 响应一般在 20-200 字节之间, 设 256 上限读到 timeout 即可
      const resp = await this.tcp.sendAndExpect(frame, 22, signal);
      const verify = verifyResponse(resp);
      if (!verify.ok) {
        this.logger.warn(`VX1000 响应校验失败: ${verify.error}`, { context: 'NovaLedAdapter' });
        // 校验失败不直接抛, 因为 VX1000 某些命令响应长度不固定;
        // 若响应头是 AA 55 就认为接收到了, 协议层面 OK
        if (resp.length < 2 || resp[0] !== 0xaa || resp[1] !== 0x55) {
          throw new DeviceProtocolError('led', `bad VX1000 response: ${resp.toString('hex')}`);
        }
      }
      this.registry.markOnline(GATEWAY_KEY);
      return resp;
    } catch (err) {
      const dErr = classifyError('led', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private getState(deviceId: string): LedState {
    const cur = this.state.get(deviceId);
    if (cur) return { ...cur };
    const fresh: LedState = { power: false, input: 'HDMI1', media: null };
    this.state.set(deviceId, fresh);
    return { ...fresh };
  }

  private updateState(deviceId: string, patch: Partial<LedState>): LedState {
    const cur = this.getState(deviceId);
    const next: LedState = {
      power: patch.power ?? cur.power,
      input: patch.input ?? cur.input,
      media: patch.media !== undefined ? patch.media : cur.media,
    };
    this.state.set(deviceId, next);
    return next;
  }
}
