import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError } from '../errors';
import { TcpClient } from '../transports/tcp-client';
import {
  FUSION_TCP_PORT,
  DEFAULT_CANVAS,
  encodeCommand,
  parseResponse,
  decodeVersion,
  decodeWindows,
  decodeOpenResult,
  decodeBoolResult,
  decodeVolumeResult,
  decodeModes,
  decodeRunningPlan,
  decodePlaylist,
  type FusionVersion,
  type FusionWindow,
  type OpenResult,
  type BoolResult,
  type VolumeResult,
  type PlaylistResult,
} from './fusion-player-protocol';

const GATEWAY_KEY = 'projector-fusion';

/**
 * 投影仪视频融合器 (JBT-SK-HD02) 适配器 —— 《播控中控控制协议 V1.1》TCP 文本命令。
 *
 * 网口直连 (自带 LAN 口, 非 485), TCP 63426, 走 TcpClient 长连接, 一发一收。
 * 协议编解码在 fusion-player-protocol.ts (已 31 个金标准测试, 全部对文档原文示例)。
 *
 * 能力: 开/关/移动/缩放窗口、切信号源、调音量/静音、调用模式(预设)、控播放列表、预案启停。
 * 窗口坐标/大小归一化 0~1; 窗口 ID 运行时分配、掉电重启会变, 不持久化。
 *
 * 【当前状态: 就绪待联调 —— 设备还没到货 (淘宝下单中)】
 * 协议层已金标准测试, adapter 结构完整, mock 路径可跑。但真机没到, 所以:
 *   - 暂不注册为 NestJS provider、不接执行路由、不动投影仪页
 *   - DriverRegistryService 只调它的 static describe(), 让它出现在 driver 目录
 * 到货后: IP 从出厂 192.168.2.168 挪到 50 网段 → 注册 provider → 接执行 → 改投影仪页 → 联调。
 *
 * 连接参数从 hardware_unit(category='projector-fusion') 的 ip + addressing.port 读, 5s TTL,
 * 后台改 IP 不重启生效 —— 跟其它 adapter 一致。
 */
@Injectable()
export class FusionPlayerAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'projector';
  }

  private tcp: TcpClient | null = null;
  private host = '';
  private port = FUSION_TCP_PORT;
  private endpoint = '';
  /** open/close 的前置画布字段, 从 hardware_unit.addressing.canvas 读, 默认 0 */
  private canvas = DEFAULT_CANVAS;

  private dbCache: { host?: string; port?: number; canvas?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;
  private readonly timeoutMs: number;

  /** mock 态: 内存里维护一组窗口 */
  private mockWindows: FusionWindow[] = [];
  private mockNextId = 1;
  private mockVol = new Map<number, { volume: number; muted: boolean }>();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    @Optional() private readonly registry?: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
  }

  // ============ 版本 / 健康 ============

  async version(ctx?: AdapterContext): Promise<AdapterResult<FusionVersion>> {
    return this.run(GATEWAY_KEY, 'version', ctx, async () => {
      if (this.isMock()) return { version: '2.4.25.60', kind: 'FUSION' };
      return decodeVersion(await this.send('version', [], ctx?.signal));
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      if (this.isMock()) return { ok: true as const };
      await this.send('version', [], ctx?.signal);
      return { ok: true as const };
    });
  }

  // ============ 窗口 ============

  async enumWindows(ctx?: AdapterContext): Promise<AdapterResult<FusionWindow[]>> {
    return this.run(GATEWAY_KEY, 'enumWindows', ctx, async () => {
      if (this.isMock()) return [...this.mockWindows];
      return decodeWindows(await this.send('enum_windows', [], ctx?.signal));
    });
  }

  /** 开窗 (放一个信号源到指定位置), 归一化坐标. 返回新窗口 ID (0=失败). */
  async openWindow(
    source: string,
    x: number,
    y: number,
    width: number,
    height: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<OpenResult>> {
    return this.run(GATEWAY_KEY, 'openWindow', ctx, async () => {
      if (this.isMock()) {
        const id = this.mockNextId++;
        this.mockWindows.push({ id, source, x, y, width, height });
        this.mockVol.set(id, { volume: 50, muted: false });
        return { windowId: id, ok: true };
      }
      // 🔧 真机: open_window 有前置画布字段 —— open_window,<画布>,源,x,y,w,h
      return decodeOpenResult(
        await this.send('open_window', [this.canvas, source, x, y, width, height], ctx?.signal),
      );
    });
  }

  /**
   * 替换窗口信号源. 返回新窗口 ID (0=失败).
   * ⚠️ **未在真机验证格式** —— replace 会改源(类似 open, 可能也有前置画布字段)。这里先按
   *   文档裸格式 `replace_window,<id>,<新源>` 发, 待厂家新版文档或联调确认后修正。
   */
  async replaceWindow(
    windowId: number,
    newSource: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<OpenResult>> {
    return this.run(GATEWAY_KEY, 'replaceWindow', ctx, async () => {
      if (this.isMock()) {
        const w = this.mockWindows.find((x) => x.id === windowId);
        if (!w) return { windowId: 0, ok: false, error: 'mock: window not found' };
        w.source = newSource;
        return { windowId, ok: true };
      }
      return decodeOpenResult(
        await this.send('replace_window', [windowId, newSource], ctx?.signal),
      );
    });
  }

  async closeWindow(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'closeWindow', ctx, async () => {
      if (this.isMock()) {
        this.mockWindows = this.mockWindows.filter((w) => w.id !== windowId);
        return { ok: true };
      }
      // 🔧 真机: close_window 有前置画布字段 —— close_window,<画布>,<窗口id>
      return decodeBoolResult(await this.send('close_window', [this.canvas, windowId], ctx?.signal));
    });
  }

  async cleanWindows(ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'cleanWindows', ctx, async () => {
      if (this.isMock()) {
        this.mockWindows = [];
        return { ok: true };
      }
      return decodeBoolResult(await this.send('clean_windows', [], ctx?.signal));
    });
  }

  async resizeWindow(
    windowId: number,
    width: number,
    height: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'resizeWindow', ctx, async () => {
      if (this.isMock()) return this.mockMutateWindow(windowId, (w) => { w.width = width; w.height = height; });
      return decodeBoolResult(await this.send('resize_window', [windowId, width, height], ctx?.signal));
    });
  }

  async moveWindow(
    windowId: number,
    x: number,
    y: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'moveWindow', ctx, async () => {
      if (this.isMock()) return this.mockMutateWindow(windowId, (w) => { w.x = x; w.y = y; });
      return decodeBoolResult(await this.send('move_window', [windowId, x, y], ctx?.signal));
    });
  }

  async playWindow(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'playWindow', ctx, async () => {
      if (this.isMock()) return this.mockMutateWindow(windowId, () => { /* noop */ });
      return decodeBoolResult(await this.send('play_window', [windowId], ctx?.signal));
    });
  }

  async pauseWindow(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'pauseWindow', ctx, async () => {
      if (this.isMock()) return this.mockMutateWindow(windowId, () => { /* noop */ });
      return decodeBoolResult(await this.send('pause_window', [windowId], ctx?.signal));
    });
  }

  // ============ 模式 / 预案 ============

  async enumModes(ctx?: AdapterContext): Promise<AdapterResult<string[]>> {
    return this.run(GATEWAY_KEY, 'enumModes', ctx, async () => {
      if (this.isMock()) return ['开馆', '接待', '闭馆'];
      return decodeModes(await this.send('enum_modes', [], ctx?.signal));
    });
  }

  async runMode(mode: string, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'runMode', ctx, async () => {
      if (this.isMock()) return { ok: true };
      return decodeBoolResult(await this.send('run_mode', [mode], ctx?.signal));
    });
  }

  async getRunningPlan(ctx?: AdapterContext): Promise<AdapterResult<{ running: boolean }>> {
    return this.run(GATEWAY_KEY, 'getRunningPlan', ctx, async () => {
      if (this.isMock()) return { running: false };
      return { running: decodeRunningPlan(await this.send('get_running_plan', [], ctx?.signal)) };
    });
  }

  async stopPlan(ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'stopPlan', ctx, async () => {
      if (this.isMock()) return { ok: true };
      return decodeBoolResult(await this.send('stop_plan', [], ctx?.signal));
    });
  }

  // ============ 音量 ============

  async setWindowVolume(
    windowId: number,
    volume: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<VolumeResult>> {
    return this.run(GATEWAY_KEY, 'setWindowVolume', ctx, async () => {
      const v = Math.max(0, Math.min(100, Math.round(volume)));
      if (this.isMock()) {
        const st = this.mockVol.get(windowId) ?? { volume: 50, muted: false };
        st.volume = v;
        this.mockVol.set(windowId, st);
        return { ok: true, volume: v, muted: st.muted };
      }
      return decodeVolumeResult(await this.send('set_window_volume', [windowId, v], ctx?.signal));
    });
  }

  async addWindowVolume(
    windowId: number,
    delta: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<VolumeResult>> {
    return this.run(GATEWAY_KEY, 'addWindowVolume', ctx, async () => {
      if (this.isMock()) return this.mockVolDelta(windowId, delta);
      return decodeVolumeResult(await this.send('add_window_volume', [windowId, delta], ctx?.signal));
    });
  }

  async subWindowVolume(
    windowId: number,
    delta: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<VolumeResult>> {
    return this.run(GATEWAY_KEY, 'subWindowVolume', ctx, async () => {
      if (this.isMock()) return this.mockVolDelta(windowId, -delta);
      return decodeVolumeResult(await this.send('sub_window_volume', [windowId, delta], ctx?.signal));
    });
  }

  async getWindowVolume(
    windowId: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<VolumeResult>> {
    return this.run(GATEWAY_KEY, 'getWindowVolume', ctx, async () => {
      if (this.isMock()) {
        const st = this.mockVol.get(windowId) ?? { volume: 50, muted: false };
        return { ok: true, volume: st.volume, muted: st.muted };
      }
      return decodeVolumeResult(await this.send('get_window_volume', [windowId], ctx?.signal));
    });
  }

  async muteWindow(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'muteWindow', ctx, async () => {
      if (this.isMock()) return this.mockSetMute(windowId, true);
      return decodeBoolResult(await this.send('mute_window', [windowId], ctx?.signal));
    });
  }

  async unmuteWindow(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'unmuteWindow', ctx, async () => {
      if (this.isMock()) return this.mockSetMute(windowId, false);
      return decodeBoolResult(await this.send('unmute_window', [windowId], ctx?.signal));
    });
  }

  // ============ 播放列表 ============

  async getPlaylist(windowId: number, ctx?: AdapterContext): Promise<AdapterResult<PlaylistResult>> {
    return this.run(GATEWAY_KEY, 'getPlaylist', ctx, async () => {
      if (this.isMock()) {
        const w = this.mockWindows.find((x) => x.id === windowId);
        if (!w) return { ok: false, error: 'mock: window not found' };
        return { ok: true, currentFile: w.source, currentIndex: 1, count: 1, files: [w.source] };
      }
      return decodePlaylist(await this.send('get_playlist', [windowId], ctx?.signal));
    });
  }

  /**
   * 指定播放列表里某文件播放. target 给 number=索引(从1开始) 或 string=文件名。
   * 文件名前逗号不能带空格 —— encodeCommand 已保证。
   */
  async setPlaylistCurrent(
    windowId: number,
    target: number | string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BoolResult>> {
    return this.run(GATEWAY_KEY, 'setPlaylistCurrent', ctx, async () => {
      if (this.isMock()) return { ok: true };
      return decodeBoolResult(
        await this.send('set_playlist_current', [windowId, target], ctx?.signal),
      );
    });
  }

  // ============ 内部 ============

  /** 发一条命令, 读到 '>' 收尾, 解析成 ParsedResponse. 失败标记 registry. */
  private async send(cmd: string, args: Array<string | number>, signal?: AbortSignal) {
    const tcp = await this.ensureClient();
    const frame = encodeCommand(cmd, args);
    try {
      const buf = await tcp.sendAndReadUntil(frame, '>', signal);
      const parsed = parseResponse(buf.toString('utf8'));
      this.registry?.markOnline(GATEWAY_KEY);
      return parsed;
    } catch (err) {
      const dErr = classifyError('projector', err);
      this.registry?.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  /** DB > env > default 三级取连接参数, 变了就重建 client (热切换). */
  private async ensureClient(): Promise<TcpClient> {
    const db = await this.getConfigFromDb();
    const host = db?.host ?? process.env.FUSION_HOST ?? '192.168.1.168';
    const port = db?.port ?? Number.parseInt(process.env.FUSION_PORT ?? String(FUSION_TCP_PORT), 10);
    this.canvas = db?.canvas ?? Number.parseInt(process.env.FUSION_CANVAS ?? String(DEFAULT_CANVAS), 10);

    if (this.tcp && host === this.host && port === this.port) return this.tcp;

    if (this.tcp) {
      this.logger.info(`FusionPlayerAdapter rewiring: ${this.host}:${this.port} → ${host}:${port}`, {
        context: 'FusionPlayerAdapter',
      });
    }
    this.host = host;
    this.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    this.tcp = new TcpClient({
      host,
      port,
      timeoutMs: this.timeoutMs,
      deviceType: 'projector',
      keepAlive: true,
      idleTimeoutMs: 30_000,
    });
    if (!this.isMock()) this.registry?.register(GATEWAY_KEY, this.endpoint);
    return this.tcp;
  }

  private async getConfigFromDb(): Promise<{ host?: string; port?: number; canvas?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port, canvas: this.dbCache.canvas };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { category: 'projector-fusion' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      let canvas: number | undefined;
      if (row.addressing) {
        try {
          const a = JSON.parse(row.addressing) as { port?: number; canvas?: number };
          port = a.port;
          canvas = a.canvas;
        } catch {
          /* addressing 不是 JSON 也 OK */
        }
      }
      this.dbCache = { host: row.ip ?? undefined, port, canvas, at: now };
      return { host: row.ip ?? undefined, port, canvas };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'FusionPlayerAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  // ---- mock 辅助 ----

  private mockMutateWindow(windowId: number, fn: (w: FusionWindow) => void): BoolResult {
    const w = this.mockWindows.find((x) => x.id === windowId);
    if (!w) return { ok: false, error: 'mock: window not found' };
    fn(w);
    return { ok: true };
  }

  private mockVolDelta(windowId: number, delta: number): VolumeResult {
    const st = this.mockVol.get(windowId) ?? { volume: 50, muted: false };
    st.volume = Math.max(0, Math.min(100, st.volume + delta));
    this.mockVol.set(windowId, st);
    return { ok: true, volume: st.volume, muted: st.muted };
  }

  private mockSetMute(windowId: number, muted: boolean): BoolResult {
    const st = this.mockVol.get(windowId) ?? { volume: 50, muted: false };
    st.muted = muted;
    this.mockVol.set(windowId, st);
    return { ok: true };
  }

  /** 给 DriverRegistryService 注册进 driver 目录用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'fusion-player',
      displayName: '投影视频融合器 (播控协议)',
      vendor: 'JBT',
      category: 'projector-fusion',
      protocol: 'tcp-text',
      capabilities: [
        'enum_windows', 'open_window', 'close_window', 'replace_window',
        'move_window', 'resize_window', 'play_window', 'pause_window',
        'enum_modes', 'run_mode', 'get_running_plan', 'stop_plan',
        'set_window_volume', 'mute_window', 'get_playlist', 'set_playlist_current',
        'health_check',
      ],
      defaultAddressing: { port: FUSION_TCP_PORT, canvas: DEFAULT_CANVAS },
      paramSchema: {
        ip: { type: 'string', label: '融合器 IP', required: true, placeholder: '192.168.1.168' },
        port: { type: 'number', label: 'TCP 端口', default: FUSION_TCP_PORT, min: 1, max: 65535 },
        canvas: { type: 'number', label: '画布/屏索引 (open/close 前置字段)', default: DEFAULT_CANVAS, min: 0, max: 7 },
      },
      remark:
        '投影仪 4K 二通道融合处理器 (JBT-SK-HD02). 网口直连 TCP 文本协议《播控中控》, 端口 63426. ' +
        '开/关/移动/缩放窗口 + 切源 + 音量 + 播放列表. 坐标归一化 0~1. ' +
        '2026-07-23 现场实机验通核心命令(固件 2.4.25.268 比文档新, open/close 有前置画布字段). ' +
        'run_mode(调预设)待设备里配好模式 + 拿厂家新版文档后补.',
    };
  }
}
