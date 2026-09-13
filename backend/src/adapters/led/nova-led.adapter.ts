import { Inject, Injectable, Optional, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
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
  frameSavePreset,
  frameReadDeviceId,
  frameSetLayer,
  ledInputToAction,
  verifyResponse,
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
 *   - HDMI1    → 逻辑 LED 主通道，切换图层 1 到 V2460 HDMI 2.0 (Source 0x90)
 *   - HDMI2    → 切换图层 1 输入到 HDMI2 (Source 0x12)
 *   - welcome/video → 与 HDMI1 相同，保持 GK9000 浏览器主显示链路
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
 *   LED_RESOLUTION_WIDTH=3612        全屏图层宽
 *   LED_RESOLUTION_HEIGHT=1462       全屏图层高
 *   LED_PRESET_WELCOME=1             welcome 对应预设号 (1-10)
 *   LED_PRESET_VIDEO=2               video 对应预设号
 *   LED_DEFAULT_BRIGHTNESS_PCT=80    powerOn 后默认亮度
 */
@Injectable()
export class NovaLedAdapter extends BaseAdapter implements OnModuleInit, OnModuleDestroy {
  get deviceType(): string {
    return 'led';
  }

  private tcp: TcpClient;
  private readonly nucHttp?: HttpClient;
  private endpoint: string;
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

  /** 当前 TcpClient 在用的 host/port — 跟 DB > env > default 三级取值比较, 决定要不要 rewire */
  private tcpHost: string;
  private tcpPort: number;

  /** 进程内状态缓存 (V/VX 系列协议没有原生 getStatus, 用缓存回填) */
  private readonly state = new Map<string, LedState>();

  /** DB 配置缓存 — 5s TTL, 避免每次发命令都查 */
  private dbCache: { host?: string; port?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  // ---- V2460 图层断电/掉配置自愈：启动后 + 周期性把图层1幂等拉回全屏 1:1 ----
  private ensureBootTimer?: ReturnType<typeof setTimeout>;
  private ensureIntervalTimer?: ReturnType<typeof setInterval>;
  private ensureInFlight = false;
  private presetSaved = false;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
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
      width: Number.parseInt(process.env.LED_RESOLUTION_WIDTH ?? '3612', 10),
      height: Number.parseInt(process.env.LED_RESOLUTION_HEIGHT ?? '1462', 10),
      presetWelcome: Number.parseInt(process.env.LED_PRESET_WELCOME ?? '1', 10),
      presetVideo: Number.parseInt(process.env.LED_PRESET_VIDEO ?? '2', 10),
      defaultBrightnessPct: Number.parseInt(process.env.LED_DEFAULT_BRIGHTNESS_PCT ?? '80', 10),
      nucHost,
      nucPort,
    };
    this.endpoint = `tcp://${host}:${port}`;
    this.tcpHost = host;
    this.tcpPort = port;

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
      `NovaLedAdapter ready (Nova V/VX=${host}:${port}` +
        (nucHost ? `, NUC=${nucHost}:${nucPort}` : ', no NUC') +
        `, ${this.cfg.width}x${this.cfg.height})`,
      { context: 'NovaLedAdapter' },
    );
  }

  /**
   * 查 DB 里 LED-NOVA-1 那条硬件记录, 提取 ip 和 addressing.port. 5s TTL.
   * 返回 null 表示 DB 不可用 / 没找到 → 调用方回退 env.
   */
  private async getConfigFromDb(): Promise<{ host?: string; port?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { code: 'LED-NOVA-1' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      if (row.addressing) {
        try {
          const parsed = JSON.parse(row.addressing) as { port?: number };
          if (typeof parsed.port === 'number') port = parsed.port;
        } catch { /* addressing 不是 JSON 也 OK */ }
      }
      this.dbCache = { host: row.ip ?? undefined, port, at: now };
      return { host: row.ip ?? undefined, port };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'NovaLedAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  /** PUT /api/hardware/:id 成功后调, 让下次 TCP 调用立刻取最新 IP. */
  invalidateConfigCache(): void {
    this.dbCache = { at: 0 };
  }

  /** P2 — 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'nova-vx',
      displayName: '诺瓦 NovaStar V/VX 系列 (LED 视频控制器)',
      vendor: '诺瓦 NovaStar',
      category: 'led-controller',
      protocol: 'nova-vx-tcp',
      capabilities: [
        'power_on', 'power_off', 'switch_input', 'set_brightness',
        'load_preset', 'save_preset', 'ensure_fullscreen_layer',
        'play_media', 'show_welcome', 'get_status', 'health_check',
      ],
      defaultAddressing: { box: '1', port: 5200 },
      paramSchema: {
        ip:                   { type: 'string', label: '控制器 IP', required: true, placeholder: '192.168.x.x' },
        port:                 { type: 'number', label: 'TCP 端口', default: 5200, min: 1, max: 65535 },
        resolutionWidth:      { type: 'number', label: '全屏图层宽 (px)', default: 3612 },
        resolutionHeight:     { type: 'number', label: '全屏图层高 (px)', default: 1462 },
        presetWelcome:        { type: 'number', label: '欢迎页预设号', default: 1, min: 1, max: 10 },
        presetVideo:          { type: 'number', label: '视频预设号', default: 2, min: 1, max: 10 },
        defaultBrightnessPct: { type: 'number', label: '开屏默认亮度 %', default: 80, min: 0, max: 100 },
      },
      remark: '兼容 V700/V760/V900/V960/V1060/V1260/V2460 + VX400/VX1000/VX1000 Pro/VX600 Pro/VX2000 Pro. TCP 5200, 帧头 0x55 0xAA, 校验和 = sum(body)+0x5555.',
    };
  }

  /**
   * 每次 TCP 调用前: DB > env > default 三级取 host:port, 跟实际 TcpClient 当前 host/port
   * 比较, 不同就重建 TcpClient + re-register registry endpoint.
   */
  private async syncRuntime(): Promise<void> {
    const db = await this.getConfigFromDb();
    const envHost = process.env.LED_HOST;
    const envPort = process.env.LED_PORT ? Number.parseInt(process.env.LED_PORT, 10) : undefined;
    const host = db?.host ?? envHost ?? '192.168.50.30';
    const port = db?.port ?? envPort ?? 5200;
    if (host === this.tcpHost && port === this.tcpPort) return;
    const source = db?.host ? 'db' : envHost ? 'env' : 'default';
    this.logger.warn(
      `NovaLedAdapter rewiring: ${this.tcpHost}:${this.tcpPort} → ${host}:${port} (source=${source})`,
      { context: 'NovaLedAdapter' },
    );
    this.tcp = new TcpClient({
      host,
      port,
      deviceType: 'led',
      timeoutMs: this.cfg.timeoutMs,
    });
    this.tcpHost = host;
    this.tcpPort = port;
    this.cfg.host = host;
    this.cfg.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
  }

  // ============ 公共 API ============

  async ping(ctx?: AdapterContext): Promise<void> {
    await this.syncRuntime();
    try {
      const frame = frameReadDeviceId();
      // ReadDeviceID 响应 VX1000=22 字节 / V2460=20 字节, 用宽松模式收到 ≥4 就算 OK
      await this.tcp.sendAndExpect(frame, 64, ctx?.signal, { minBytes: 4 });
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('led', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, false);
      throw dErr;
    }
  }

  // ============ V2460 全屏图层断电自愈 ============

  /**
   * 后端启动即安排"全屏图层自愈"：
   *   - 启动延迟 LED_ENSURE_BOOT_DELAY_MS（默认 15s，等网络/设备就绪）后校正一次；
   *   - 之后每 LED_ENSURE_INTERVAL_MS（默认 5min，设 0 关闭周期校正）幂等校正一次。
   * 作用：V2460 断电重启或被现场软件改动后，图层窗口可能丢失/非全屏；后端会自动把
   * 图层1拉回"HDMI2.0 输入、(0,0) 起、整屏 1:1、正常显示"，无需人工到现场。
   * 设 LED_ENSURE_LAYER=off 可整体关闭；mock/本地开发模式自动跳过。
   */
  onModuleInit(): void {
    if (this.isMock()) return;
    if ((process.env.LED_ENSURE_LAYER ?? 'on').toLowerCase() === 'off') return;
    const bootDelay = Number.parseInt(process.env.LED_ENSURE_BOOT_DELAY_MS ?? '15000', 10) || 15000;
    const intervalMs = Number.parseInt(process.env.LED_ENSURE_INTERVAL_MS ?? String(5 * 60 * 1000), 10);
    this.ensureBootTimer = setTimeout(() => { void this.ensureFullscreenLayer('boot'); }, Math.max(0, bootDelay));
    if (Number.isFinite(intervalMs) && intervalMs > 0) {
      this.ensureIntervalTimer = setInterval(() => { void this.ensureFullscreenLayer('periodic'); }, intervalMs);
    }
    this.logger.info(
      `V2460 全屏图层自愈已启用 (bootDelay=${bootDelay}ms, interval=${intervalMs}ms)`,
      { context: 'NovaLedAdapter' },
    );
  }

  onModuleDestroy(): void {
    if (this.ensureBootTimer) clearTimeout(this.ensureBootTimer);
    if (this.ensureIntervalTimer) clearInterval(this.ensureIntervalTimer);
  }

  /**
   * 幂等把 V2460 图层1拉回到全屏 1:1 并置为正常显示；首次成功时把当前配置存为预设
   * （设备层快照，双保险）。任何失败只记录、不抛，绝不影响后端主流程。返回是否成功。
   * 也可由运维接口/手动调用。
   */
  async ensureFullscreenLayer(reason = 'manual'): Promise<boolean> {
    if (this.ensureInFlight) return false;
    this.ensureInFlight = true;
    try {
      await this.ping(); // 探活；设备不在线会抛错，进入 catch 安静跳过
      const action = ledInputToAction('video', {
        welcome: this.cfg.presetWelcome,
        video: this.cfg.presetVideo,
      });
      if (action.kind !== 'layer') return false;
      await this.sendVx(frameSetLayer({
        layerNo: 1,
        source: action.source,
        cardSlot: action.cardSlot,
        width: this.cfg.width,
        height: this.cfg.height,
        startX: 0,
        startY: 0,
        priority: 0,
        opacity: 0x64,
        switchOn: true,
      }));
      await this.sendVx(frameDisplayMode(VX_DISPLAY_MODE.NORMAL));
      // 首次成功后把当前正确的全屏配置固化进设备预设槽（只存一次，幂等）
      if (!this.presetSaved) {
        try {
          await this.sendVx(frameSavePreset(this.cfg.presetVideo));
          this.presetSaved = true;
        } catch (presetErr) {
          this.logger.warn(
            `V2460 保存预设失败（不影响图层校正）: ${(presetErr as Error).message}`,
            { context: 'NovaLedAdapter' },
          );
        }
      }
      this.logger.info(
        `V2460 全屏图层已确保 (${reason}, ${this.cfg.width}x${this.cfg.height})`,
        { context: 'NovaLedAdapter' },
      );
      return true;
    } catch (err) {
      this.logger.debug(
        `V2460 图层自愈本次跳过 (${reason}): ${(err as Error).message}`,
        { context: 'NovaLedAdapter' },
      );
      return false;
    } finally {
      this.ensureInFlight = false;
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
        await this.sendVx(
          frameSetLayer({
            layerNo: 1,
            source: action.source,
            cardSlot: action.cardSlot,
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
      // 1) 拉正到 V2460 HDMI 2.0 主链路。不能加载历史 video 预设：
      // 现场旧预设仍指向 HDMI 1.3，会让画面在“成功”提示后又黑掉/延迟切换。
      const action = ledInputToAction('video', {
        welcome: this.cfg.presetWelcome,
        video: this.cfg.presetVideo,
      });
      if (action.kind !== 'layer') throw new DeviceProtocolError('led', 'video input is not a layer action');
      await this.sendVx(frameSetLayer({
        layerNo: 1,
        source: action.source,
        cardSlot: action.cardSlot,
        width: this.cfg.width,
        height: this.cfg.height,
        startX: 0,
        startY: 0,
        priority: 0,
        opacity: 0x64,
        switchOn: true,
      }), ctx?.signal);
      // 2) 若现场配了独立 NUC, 再通知 NUC 播放指定文件；当前现场由 GK9000 浏览器播放。
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
      // 欢迎页现在由 GK9000 浏览器渲染，显示链路与普通内容相同。
      const action = ledInputToAction('welcome', {
        welcome: this.cfg.presetWelcome,
        video: this.cfg.presetVideo,
      });
      if (action.kind !== 'layer') throw new DeviceProtocolError('led', 'welcome input is not a layer action');
      await this.sendVx(frameSetLayer({
        layerNo: 1,
        source: action.source,
        cardSlot: action.cardSlot,
        width: this.cfg.width,
        height: this.cfg.height,
        startX: 0,
        startY: 0,
        priority: 0,
        opacity: 0x64,
        switchOn: true,
      }), ctx?.signal);
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

  /** 发送一帧给 V/VX 系列, 验证响应; 失败计入 registry */
  private async sendVx(frame: Buffer, signal?: AbortSignal): Promise<Buffer> {
    await this.syncRuntime();
    try {
      // 不同型号响应长度不同 (VX1000 ReadDeviceID 22 字节, V2460 20 字节, 亮度/显示模式
      // 命令 17-21 字节不等)。V2460 回完不会主动断开 TCP；旧实现固定等 64 字节，
      // 因而每次切输入源即使已经收到了完整响应也要卡满 3 秒超时。用短静默窗口收齐
      // 变长帧：最后一段回包后 120ms 即返回，整体仍受设备超时保护。
      const resp = await this.tcp.sendAndReadAll(frame, 120, this.cfg.timeoutMs, signal);
      const verify = verifyResponse(resp);
      if (!verify.ok) {
        this.logger.warn(`Nova V/VX 响应校验失败: ${verify.error}`, { context: 'NovaLedAdapter' });
        // 校验失败不直接抛, 因为不同型号响应字节有差异;
        // 只要响应头是 AA 55 就认为通了, 上层逻辑 OK
        if (resp.length < 2 || resp[0] !== 0xaa || resp[1] !== 0x55) {
          throw new DeviceProtocolError('led', `bad Nova response: ${resp.toString('hex')}`);
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
