import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { TcpClient } from '../transports/tcp-client';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError } from '../errors';
import { withRetry } from '../retry';
import type { AudioState, AudioZone } from './mock-audio.adapter';
import {
  cmdRecallUserPreset,
  cmdReadPreset,
  cmdSetOutputVolume,
  cmdSetInputVolume,
  cmdMute,
  cmdReadGain,
  cmdReadMute,
  cmdSetMatrix,
  cmdGroupVolume,
  cmdAuxSwitch,
  cmdReadLevel,
  parseFrame,
  codeToDb,
  singleByteCodeToDb,
  levelByteToDb,
  AUX_SW,
  IO_OUT,
  IO_IN,
  type ChannelIndex,
  type AuxSwitchKind,
  type IODirection,
  FRAME_LEN,
} from './ekx808-protocol';

const GATEWAY_KEY = 'audio-ekx808';

/**
 * 得胜 TAKSTAR EKX-808 8x8 数字矩阵 DSP 适配器
 *
 * 走 TCP 短连接 (默认 IP 192.168.50.61), 协议封装在 ekx808-protocol.ts
 * 启用方式: 设置 env AUDIO_VENDOR=takstar-ekx808 (默认 'dsppa' 时不启用)
 *
 * 兼容 AudioAdapter 标准接口 (setVolume/mute/...) — 区映射规则:
 *   audio_1f         -> Out Ch 1  (1F 前厅区)
 *   audio_2f         -> Out Ch 4  (2F 前厅区)
 *   audio_meeting    -> Out Ch 7  (ZONE 8 会议室独立)
 *   audio_roadshow   -> Out Ch 0  (ZONE 1 路演 + LED 大屏)
 *   (其余通道 2/3/5/6 用 zone 参数显式指定)
 *
 * 新增方法 (EKX-808 专属):
 *   recallScene(presetNum)   — 调用用户预设 U01-U12, 一键场景切换
 *   readCurrentScene()       — 读当前预设号
 *   setMatrix(out, in, on)   — 8x8 矩阵单点路由
 *   auxSwitch(kind, on)      — AEC / NR / 摄像跟踪 / 自动混音 开关
 *   readLevel(io, ch)        — 实时电平表
 */
@Injectable()
export class EkxDspAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'audio';
  }

  private tcp: TcpClient;
  private host: string;
  private port: number;
  private readonly devAddr: number;
  private readonly timeoutMs: number;
  private readonly retries: number;

  /** DB 配置缓存 — 5s TTL */
  private dbCache: { host?: string; port?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  /** zone 名 → DSP 输出通道索引 (0-7) */
  private static readonly ZONE_TO_OUT: Record<string, ChannelIndex> = {
    '1f_bg': 1,
    '2f_bg': 4,
    meeting: 7,
    roadshow: 0,
  };

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.host = process.env.AUDIO_EKX_HOST ?? '192.168.50.61';
    this.port = Number.parseInt(process.env.AUDIO_EKX_PORT ?? '5000', 10);
    this.devAddr = Number.parseInt(process.env.AUDIO_EKX_DEV_ADDR ?? '1', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
    this.tcp = new TcpClient({
      host: this.host,
      port: this.port,
      deviceType: 'audio',
      timeoutMs: this.timeoutMs,
    });
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, `tcp://${this.host}:${this.port}`);
    this.logger.info(
      `EkxDspAdapter ready (host=${this.host}:${this.port} devAddr=${this.devAddr} mode=${this.isMock() ? 'mock' : 'live'})`,
      { context: 'EkxDspAdapter' },
    );
  }

  /** 查 DB 里 AUDIO-DSP-1 那条硬件记录, 提取 ip + addressing.tcpPort/port. 5s TTL. */
  private async getConfigFromDb(): Promise<{ host?: string; port?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { code: 'AUDIO-DSP-1' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      if (row.addressing) {
        try {
          const parsed = JSON.parse(row.addressing) as { tcpPort?: number; port?: number };
          // 兼容历史 seed 的 tcpPort 字段名 + 通用 port 字段
          if (typeof parsed.tcpPort === 'number') port = parsed.tcpPort;
          else if (typeof parsed.port === 'number') port = parsed.port;
        } catch { /* addressing 不是 JSON 也 OK */ }
      }
      this.dbCache = { host: row.ip ?? undefined, port, at: now };
      return { host: row.ip ?? undefined, port };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'EkxDspAdapter' });
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
      kind: 'ekx-808',
      displayName: '得胜 TAKSTAR EKX-808 (8×8 数字矩阵 DSP)',
      vendor: '得胜 TAKSTAR',
      category: 'audio-dsp',
      protocol: 'takstar-ekx-tcp',
      capabilities: [
        'set_volume', 'mute', 'recall_scene', 'read_current_scene',
        'set_matrix', 'aux_switch', 'read_level', 'health_check',
      ],
      defaultAddressing: { devAddr: 1, tcpPort: 5000, inputs: 8, outputs: 8 },
      paramSchema: {
        ip:      { type: 'string', label: 'DSP IP', required: true, placeholder: '192.168.x.x' },
        tcpPort: { type: 'number', label: 'TCP 端口', default: 5000, min: 1, max: 65535 },
        devAddr: { type: 'number', label: '设备地址', default: 1, min: 1, max: 254 },
      },
      remark: '8 输入 8 输出数字音频矩阵 + DSP, 支持用户预设 U01-U12, AEC/NR/摄像跟踪/自动混音开关.',
    };
  }

  /** 每次 TCP 调用前: DB > env > default 三级取 host:port, 不同就重建 TcpClient. */
  private async syncRuntime(): Promise<void> {
    const db = await this.getConfigFromDb();
    const envHost = process.env.AUDIO_EKX_HOST;
    const envPort = process.env.AUDIO_EKX_PORT ? Number.parseInt(process.env.AUDIO_EKX_PORT, 10) : undefined;
    const host = db?.host ?? envHost ?? '192.168.50.61';
    const port = db?.port ?? envPort ?? 5000;
    if (host === this.host && port === this.port) return;
    const source = db?.host ? 'db' : envHost ? 'env' : 'default';
    this.logger.warn(
      `EkxDspAdapter rewiring: ${this.host}:${this.port} → ${host}:${port} (source=${source})`,
      { context: 'EkxDspAdapter' },
    );
    this.tcp = new TcpClient({
      host,
      port,
      deviceType: 'audio',
      timeoutMs: this.timeoutMs,
    });
    this.host = host;
    this.port = port;
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, `tcp://${host}:${port}`);
  }

  // ============ 基础: ping + 健康检查 ============

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      // 读当前预设号 — 最轻量的一次问答
      await this.send(cmdReadPreset(this.devAddr), ctx?.signal, true);
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

  // ============ 兼容 AudioAdapter 通用接口 ============

  async setVolume(
    deviceId: string,
    params: { value?: number; zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, 'setVolume', ctx, async () => {
      const ch = this.channelFor(deviceId, params.zone);
      const percent = Math.max(0, Math.min(100, Number(params.value ?? 0)));
      const db = this.percentToDb(percent);
      await this.send(cmdSetOutputVolume(this.devAddr, ch, db), ctx?.signal);
      return this.readState(ch, ctx?.signal);
    });
  }

  async mute(
    deviceId: string,
    params: { zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    return this.muteCommon(deviceId, params, true, ctx);
  }

  async unmute(
    deviceId: string,
    params: { zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    return this.muteCommon(deviceId, params, false, ctx);
  }

  private async muteCommon(
    deviceId: string,
    params: { zone?: AudioZone },
    muted: boolean,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    return this.run(deviceId, muted ? 'mute' : 'unmute', ctx, async () => {
      const ch = this.channelFor(deviceId, params.zone);
      await this.send(cmdMute(this.devAddr, IO_OUT, ch, muted), ctx?.signal);
      return this.readState(ch, ctx?.signal);
    });
  }

  async playBgm(
    deviceId: string,
    _params: { track?: string; channel?: string; zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    // EKX-808 本身不放音乐, BGM 由 MG-10M 定时播放器或外部音源接入 In 通道
    // 这里只解除该通道静音 (假定 BGM 源已挂在 In 上)
    return this.unmute(deviceId, _params, ctx);
  }

  async stopBgm(
    deviceId: string,
    params: { zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    return this.mute(deviceId, params, ctx);
  }

  async enableMic(
    deviceId: string,
    params: { enable?: boolean; zone?: AudioZone } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<AudioState>> {
    // 麦克风走 In 通道, 用 In 静音/解除控制
    return this.run(deviceId, 'enableMic', ctx, async () => {
      const ch = this.channelFor(deviceId, params.zone);
      const muted = params.enable === false;
      await this.send(cmdMute(this.devAddr, IO_IN, ch, muted), ctx?.signal);
      return this.readState(ch, ctx?.signal);
    });
  }

  // ============ EKX-808 专属: 场景预设 ============

  /** 调用用户预设 U01-U12 (一键场景切换, 整机 8 路全部生效) */
  async recallScene(presetNum: number, ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    return this.run('audio-dsp', `recallScene_U${String(presetNum).padStart(2, '0')}`, ctx, async () => {
      if (presetNum < 1 || presetNum > 12) {
        throw new Error(`预设号必须 1-12, got ${presetNum}`);
      }
      await this.send(cmdRecallUserPreset(this.devAddr, presetNum), ctx?.signal);
      return { preset: presetNum };
    });
  }

  /** 读当前激活的预设号 (返回 0 = F00, 1-12 = U01-U12) */
  async readCurrentScene(ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    return this.run('audio-dsp', 'readCurrentScene', ctx, async () => {
      const resp = await this.send(cmdReadPreset(this.devAddr), ctx?.signal, true);
      const f = parseFrame(resp);
      const preset = f ? f.payload[0] : 0;
      return { preset };
    });
  }

  /** 矩阵单点路由 (Out X ← In Y) */
  async setMatrix(out: ChannelIndex, input: ChannelIndex, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ out: number; input: number; on: boolean }>> {
    return this.run('audio-dsp', `setMatrix_O${out}_I${input}_${on ? 'on' : 'off'}`, ctx, async () => {
      await this.send(cmdSetMatrix(this.devAddr, out, input, on), ctx?.signal);
      return { out, input, on };
    });
  }

  /** 辅助开关 (效果器/摄像跟踪/自动混音/AEC/降噪) */
  async auxSwitch(kind: AuxSwitchKind, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ kind: number; on: boolean }>> {
    const name = Object.entries(AUX_SW).find(([, v]) => v === kind)?.[0] ?? `kind${kind}`;
    return this.run('audio-dsp', `auxSwitch_${name}_${on ? 'on' : 'off'}`, ctx, async () => {
      await this.send(cmdAuxSwitch(this.devAddr, kind, on), ctx?.signal);
      return { kind, on };
    });
  }

  /** 编组整体音量 (输入/输出 整层一刀切) */
  async setGroupVolume(io: IODirection, percent: number, ctx?: AdapterContext): Promise<AdapterResult<{ io: number; percent: number }>> {
    return this.run('audio-dsp', `groupVolume_${io === IO_IN ? 'in' : 'out'}_${percent}`, ctx, async () => {
      await this.send(cmdGroupVolume(this.devAddr, io, percent), ctx?.signal);
      return { io, percent };
    });
  }

  /** 读单通道实时电平 (用于 UI 电平条) */
  async readLevel(io: 0 | 1 | 2, channel: ChannelIndex, ctx?: AdapterContext): Promise<AdapterResult<{ db: number }>> {
    return this.run('audio-dsp', `readLevel_${io}_${channel}`, ctx, async () => {
      const resp = await this.send(cmdReadLevel(this.devAddr, io, channel), ctx?.signal, true);
      const f = parseFrame(resp);
      const db = f ? levelByteToDb(f.payload[2]) : -128;
      return { db };
    });
  }

  // ============ 私有工具 ============

  private channelFor(deviceId: string, zone?: AudioZone): ChannelIndex {
    if (zone && EkxDspAdapter.ZONE_TO_OUT[zone] !== undefined) {
      return EkxDspAdapter.ZONE_TO_OUT[zone];
    }
    if (EkxDspAdapter.ZONE_TO_OUT[deviceId] !== undefined) {
      return EkxDspAdapter.ZONE_TO_OUT[deviceId];
    }
    // 数字 deviceId 直接当通道号
    const n = Number(deviceId);
    if (Number.isFinite(n) && n >= 0 && n <= 7) return n as ChannelIndex;
    return 0;
  }

  /** 百分比 (0-100) → dB (-60 ~ +12), 0=-∞, 100=+12dB, 50=-10dB */
  private percentToDb(percent: number): number {
    if (percent <= 0) return -60;
    if (percent >= 100) return 12;
    // 非线性映射: 0-50% 对应 -60 ~ -10dB, 50-100% 对应 -10 ~ +12dB
    if (percent < 50) return -60 + (percent / 50) * 50;
    return -10 + ((percent - 50) / 50) * 22;
  }

  /** 读取通道当前状态 (合成 AudioState) */
  private async readState(ch: ChannelIndex, signal?: AbortSignal): Promise<AudioState> {
    let volume = 0;
    let muted = false;
    try {
      const gainResp = await this.send(cmdReadGain(this.devAddr, IO_OUT, ch), signal, true);
      const g = parseFrame(gainResp);
      if (g) {
        const db = singleByteCodeToDb(g.payload[2]);
        volume = Math.round(this.dbToPercent(db));
      }
    } catch {
      /* 读取失败不阻塞主路径 */
    }
    try {
      const muteResp = await this.send(cmdReadMute(this.devAddr, IO_OUT, ch), signal, true);
      const m = parseFrame(muteResp);
      if (m) muted = m.payload[0] === 1;
    } catch {
      /* 同上 */
    }
    return { volume, muted, bgm: null, micEnabled: false };
  }

  /** dB → 百分比 (反向, 仅用于状态回读) */
  private dbToPercent(db: number): number {
    if (db <= -60) return 0;
    if (db >= 12) return 100;
    if (db < -10) return ((db + 60) / 50) * 50;
    return 50 + ((db + 10) / 22) * 50;
  }

  /** 单条命令发送 (带重试). expectResponse=true 时等待 9 字节响应帧 */
  private async send(payload: Buffer, signal?: AbortSignal, expectResponse = false): Promise<Buffer> {
    await this.syncRuntime();
    try {
      const result = await withRetry(
        async () => {
          if (expectResponse) {
            return await this.tcp.sendAndExpect(payload, FRAME_LEN, signal);
          }
          await this.tcp.send(payload, signal);
          return Buffer.alloc(0);
        },
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(GATEWAY_KEY);
      return result;
    } catch (err) {
      const dErr = classifyError('audio', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }
}
