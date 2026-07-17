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
  cmdReadMatrixCell,
  cmdReadFullMatrix,
  parseFullMatrix,
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
  percentToDb as protoPercentToDb,
} from './ekx808-protocol';

const GATEWAY_KEY = 'audio-ekx808';

/** 单路输出在某场景里的配置 */
export interface SceneOutputConfig {
  /** 输出通道 0-7 */
  ch: number;
  /** 喂给这路输出的输入通道号 (0-7), 多个=混音. 不传=不动这路的路由 */
  inputs?: number[];
  /** 输出音量 0-100. 不传=不动音量 */
  volume?: number;
  /** 是否静音. 不传=不动静音 */
  muted?: boolean;
}

/** 一个场景的完整内容 (后台可编辑, 切场景时逐条下发到矩阵) */
export interface SceneContent {
  outputs: SceneOutputConfig[];
}

/**
 * 得胜 TAKSTAR EKX-808 8x8 数字矩阵 DSP 适配器
 *
 * 走 TCP 短连接 (默认 IP 192.168.50.61), 协议封装在 ekx808-protocol.ts
 * 启用方式: 设置 env AUDIO_VENDOR=takstar-ekx808 (默认 'dsppa' 时不启用)
 *
 * 兼容 AudioAdapter 标准接口 (setVolume/mute/...) — zone 参数用 out1..out8,
 * 直接对应物理输出 1-8 (见 ZONE_TO_OUT)。通道叫什么名字**不在代码里**,
 * 存 audio_output_zone / audio_input_source 表, 后台可改 (GET/PUT /api/audio-config/*)。
 *
 * 现场实际接线 (2026-07-16 机柜标签):
 *   IN1 中控主机   IN2 定时播放器   IN3 调音台   IN4 中控主机2   (IN5-8 未接)
 *   OUT1 一楼门厅  OUT2 一楼东北   OUT3 一楼中厅  OUT4 一楼南厅
 *   OUT5 一楼大屏  OUT6 一楼投影仪  OUT7 二楼走廊  OUT8 二楼办公区
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

  /**
   * 命令串行锁. EKX-808 是**单客户端设备** — 同一时刻只接受一个 TCP 连接.
   * 现场实测 (2026-06-13 netstat): backend 健康探测 + API 读并发开 2 个连接时,
   * 第二个卡在 SYN_SENT 连不上, 设备读响应直接废 (写命令照样收, 但读不回).
   * 所有 send 经这把锁排队, 保证任意时刻只有一个连接, 读写都稳.
   */
  private cmdLock: Promise<unknown> = Promise.resolve();

  /**
   * applyScene 增量缓存 — 记住上次下发到设备的 8×8 矩阵 / 8 路音量 / 8 路静音.
   * 切场景时只发跟缓存不一样的格子, 避免每次全量 ~80 条命令 (单客户端串行会很慢).
   * null = 未知 (backend 刚起 / 换过设备), 下次 applyScene 对应项全量下发.
   * 手动 setVolume/mute/setMatrix 也会同步更新这里, 防止缓存跟真实状态脱节.
   */
  private appliedMatrix: (boolean | null)[][] = Array.from({ length: 8 }, () => Array<boolean | null>(8).fill(null));
  private appliedVol: (number | null)[] = Array<number | null>(8).fill(null);
  private appliedMute: (boolean | null)[] = Array<boolean | null>(8).fill(null);

  /** 清空增量缓存 → 下次 applyScene 全量下发. 业主用过厂家 PC Editor / 换设备后调. */
  resetSceneCache(): void {
    this.appliedMatrix = Array.from({ length: 8 }, () => Array<boolean | null>(8).fill(null));
    this.appliedVol = Array<number | null>(8).fill(null);
    this.appliedMute = Array<boolean | null>(8).fill(null);
  }

  /**
   * zone 名 → DSP 输出通道索引 (0-based: 0=OUT1 ... 7=OUT8).
   * 通道的**显示名**不在这里 — 存 audio_output_zone 表, 后台/PWA 可改
   * (2026-07-16 已按机柜标签配好: OUT1 一楼门厅 ... OUT8 二楼办公区)。
   * 这张表只负责 "out1" 这个 key → 物理通道号 的固定对应, 不用动。
   */
  private static readonly ZONE_TO_OUT: Record<string, ChannelIndex> = {
    out1: 0, out2: 1, out3: 2, out4: 3,
    out5: 4, out6: 5, out7: 6, out8: 7,
  };

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.host = process.env.AUDIO_EKX_HOST ?? '192.168.50.61';
    // 默认 TCP 端口: 9761 (得胜 EKX-808 网口控制端口)
    // 2026-06-13 现场抓厂家 PC Editor 软件的真实 TCP 连接确认: PC 软件连的是 9761.
    // (9760 是设备的 echo 干扰端口, 一字之差坑了两天). EKX 单客户端, 短连接一问一答.
    this.port = Number.parseInt(process.env.AUDIO_EKX_PORT ?? '9761', 10);
    this.devAddr = Number.parseInt(process.env.AUDIO_EKX_DEV_ADDR ?? '1', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
    this.tcp = new TcpClient({
      host: this.host,
      port: this.port,
      deviceType: 'audio',
      timeoutMs: this.timeoutMs,
      // EKX-808 单客户端 + 对短连接频繁开关敏感 → 跟厂家 PC 软件一样保持一条长连接.
      // idle 8s 后自动断开, 释放给业主用 PC Editor 调试 (backend 空闲 8s 即让出).
      keepAlive: true,
      idleTimeoutMs: 8000,
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
      defaultAddressing: { devAddr: 1, tcpPort: 9761, inputs: 8, outputs: 8 },
      paramSchema: {
        ip:      { type: 'string', label: 'DSP IP', required: true, placeholder: '192.168.x.x' },
        tcpPort: { type: 'number', label: 'TCP 端口', default: 9761, min: 1, max: 65535 },
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
    const port = db?.port ?? envPort ?? 9761;
    if (host === this.host && port === this.port) return;
    const source = db?.host ? 'db' : envHost ? 'env' : 'default';
    this.logger.warn(
      `EkxDspAdapter rewiring: ${this.host}:${this.port} → ${host}:${port} (source=${source})`,
      { context: 'EkxDspAdapter' },
    );
    this.tcp.dispose();  // 关掉旧长连接, 换 host/port 重建
    this.tcp = new TcpClient({
      host,
      port,
      deviceType: 'audio',
      timeoutMs: this.timeoutMs,
      keepAlive: true,
      idleTimeoutMs: 8000,
    });
    this.host = host;
    this.port = port;
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, `tcp://${host}:${port}`);
    this.resetSceneCache(); // 换了设备 → 设备真实状态未知, 下次场景全量下发
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
      // 写命令: 发完读 "OK" 确认. 不再额外 readState (EKX 单客户端, 连发多个连接
      // 容易被拒). 乐观返回刚设的值 — PWA 本来就用自己的滑条值, 不依赖回读.
      await this.send(cmdSetOutputVolume(this.devAddr, ch, db), ctx?.signal);
      this.appliedVol[ch] = percent; // 同步增量缓存
      return { volume: percent, muted: false, bgm: null, micEnabled: false };
    });
  }

  /** 设置输入通道增益 (0-100% → dB). 前台"音源矩阵"输入增益用 — EKX 用户预设常把
   *  输入压到 -60dB(最小), 矩阵通了也没声, 这里能把输入拉回来. */
  async setInputVolume(channel: ChannelIndex, percent: number, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; volume: number }>> {
    return this.run('audio-dsp', `setInputVolume_I${channel}`, ctx, async () => {
      const v = Math.max(0, Math.min(100, Number(percent)));
      await this.send(cmdSetInputVolume(this.devAddr, channel, this.percentToDb(v)), ctx?.signal);
      return { channel, volume: v };
    });
  }

  /**
   * 直接按 **dB** 设输入增益 (-60 ~ +12)。
   *
   * 为什么不复用 setInputVolume(percent): percentToDb 是非线性的 (0-50% -> -60~-10dB,
   * 50-100% -> -10~+12dB), 存 dB 再反推百分比会有精度损失, 对账时就会反复"纠正"
   * 一个其实已经对了的值 —— 每 30 秒白打一次设备。底层 cmdSetInputVolume 本来就收 dB,
   * 直接给它。AudioReconciler 用这个。
   */
  async setInputGainDb(channel: ChannelIndex, db: number, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; gainDb: number }>> {
    return this.run('audio-dsp', `setInputGainDb_I${channel}`, ctx, async () => {
      const d = Math.max(-60, Math.min(12, Number(db)));
      await this.send(cmdSetInputVolume(this.devAddr, channel, d), ctx?.signal);
      return { channel, gainDb: d };
    });
  }

  /** 输入通道静音/解除 (AudioReconciler 用; enableMic 那个是按 deviceId/zone 找通道的, 这里直接给通道号) */
  async setInputMuted(channel: ChannelIndex, muted: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; muted: boolean }>> {
    return this.run('audio-dsp', `setInputMuted_I${channel}`, ctx, async () => {
      await this.send(cmdMute(this.devAddr, IO_IN, channel, muted), ctx?.signal);
      return { channel, muted };
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
      this.appliedMute[ch] = muted; // 同步增量缓存
      return { volume: 0, muted, bgm: null, micEnabled: false };
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
      return { volume: 0, muted, bgm: null, micEnabled: params.enable !== false };
    });
  }

  // ============ EKX-808 专属: 场景预设 ============

  /** 调用用户预设 U01-U12 (一键场景切换, 整机 8 路全部生效) */
  async recallScene(presetNum: number, ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    return this.run('audio-dsp', `recallScene_U${String(presetNum).padStart(2, '0')}`, ctx, async () => {
      if (presetNum < 1 || presetNum > 12) {
        throw new Error(`预设号必须 1-12, got ${presetNum}`);
      }
      // ⚠️ off-by-one: 设备 recall 是 0-indexed (U01 = D2=0, U12 = D2=11),
      // 但回读 readPreset 是 1-indexed (U01 = 1). 2026-06-13 现场实测确认:
      // 发 D2=2 回读 03 = U03. PWA 传 1-12 (U01-U12), 这里要 -1 才对得上设备.
      await this.send(cmdRecallUserPreset(this.devAddr, presetNum - 1), ctx?.signal);
      return { preset: presetNum };
    });
  }

  /**
   * 下发一个"后台编辑的场景内容"到矩阵 — 逐条发 setMatrix + 输出音量 + 静音,
   * 把整机摆成 content 描述的样子. 走增量缓存: 只发跟上次不一样的, 切场景通常很快.
   * (跟设备内置预设 recallScene 不同 — 这个的内容存在我们 DB 里, 业主后台可改.)
   */
  async applyScene(content: SceneContent, ctx?: AdapterContext): Promise<AdapterResult<{ commands: number; outputs: number }>> {
    return this.run('audio-dsp', 'applyScene', ctx, async () => {
      let cmds = 0;
      const outs = Array.isArray(content?.outputs) ? content.outputs : [];
      for (const out of outs) {
        const ch = Number(out.ch);
        if (!Number.isInteger(ch) || ch < 0 || ch > 7) continue;
        const cch = ch as ChannelIndex;
        // 1) 矩阵路由: 逐个输入比对缓存, 只发变化的格子 (Out cch ← In inp 开/关)
        if (Array.isArray(out.inputs)) {
          const wanted = new Set(out.inputs.map(Number).filter((n) => n >= 0 && n <= 7));
          for (let inp = 0; inp < 8; inp++) {
            const desired = wanted.has(inp);
            if (this.appliedMatrix[cch][inp] !== desired) {
              await this.send(cmdSetMatrix(this.devAddr, cch, inp as ChannelIndex, desired), ctx?.signal);
              this.appliedMatrix[cch][inp] = desired;
              cmds++;
            }
          }
        }
        // 2) 输出音量 (百分比 → dB)
        if (typeof out.volume === 'number' && Number.isFinite(out.volume)) {
          const v = Math.max(0, Math.min(100, Math.round(out.volume)));
          if (this.appliedVol[cch] !== v) {
            await this.send(cmdSetOutputVolume(this.devAddr, cch, this.percentToDb(v)), ctx?.signal);
            this.appliedVol[cch] = v;
            cmds++;
          }
        }
        // 3) 静音
        if (typeof out.muted === 'boolean' && this.appliedMute[cch] !== out.muted) {
          await this.send(cmdMute(this.devAddr, IO_OUT, cch, out.muted), ctx?.signal);
          this.appliedMute[cch] = out.muted;
          cmds++;
        }
      }
      return { commands: cmds, outputs: outs.length };
    });
  }

  /** 读当前激活的预设号 (返回 0 = F00, 1-12 = U01-U12) */
  /**
   * 读设备**真实**的 8×8 路由表 — 一条命令 (0x61), 实测 ~284ms.
   *
   * 这是前端矩阵界面唯一该信的数据源。以前前端点一下就把结果存进本地 JSON
   * 文件 (GET/POST /api/audio/matrix/state), 那记的是"谁点过什么", 不是设备
   * 状态 —— 而且命令失败时照样存, 于是界面亮着一个从没接通过的交叉点。
   *
   * 别逐点读: 64 个点 × ~280ms ≈ 18s (EKX 单客户端 + 串行锁, 快不了)。
   */
  async readFullMatrix(ctx?: AdapterContext): Promise<AdapterResult<{ matrix: boolean[][] }>> {
    return this.run('audio-dsp', 'readFullMatrix', ctx, async () => {
      const resp = await this.send(cmdReadFullMatrix(this.devAddr), ctx?.signal, true);
      const matrix = parseFullMatrix(resp);
      if (!matrix) {
        throw new Error(`全矩阵回帧解析失败 (${resp.length}B): ${resp.toString('hex')}`);
      }
      return { matrix };
    });
  }

  /**
   * 读 8 路输入的真实增益 + 静音. 实测 ~4.6s (16 次往返, 每次 ~280ms).
   *
   * 慢是因为协议只能逐路读 (没有批量读增益的命令), 而 EKX 单客户端必须串行。
   * 所以这个别放进轮询, 开页面读一次 + 改完复读即可。
   */
  async readInputChannels(
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ channels: Array<{ ch: number; gainDb: number | null; muted: boolean | null }> }>> {
    return this.run('audio-dsp', 'readInputChannels', ctx, async () => {
      const channels: Array<{ ch: number; gainDb: number | null; muted: boolean | null }> = [];
      for (let ch = 0; ch < 8; ch += 1) {
        let gainDb: number | null = null;
        let muted: boolean | null = null;
        try {
          const g = await this.send(cmdReadGain(this.devAddr, IO_IN, ch as ChannelIndex), ctx?.signal, true);
          if (g.length >= 4) gainDb = codeToDb(g[2], g[3]);
        } catch { /* 单路读不到不拖垮整批, 留 null = 未知 */ }
        try {
          const m = await this.send(cmdReadMute(this.devAddr, IO_IN, ch as ChannelIndex), ctx?.signal, true);
          if (m.length >= 3) muted = m[2] === 1;
        } catch { /* 同上 */ }
        channels.push({ ch, gainDb, muted });
      }
      return { channels };
    });
  }

  async readCurrentScene(ctx?: AdapterContext): Promise<AdapterResult<{ preset: number }>> {
    return this.run('audio-dsp', 'readCurrentScene', ctx, async () => {
      const resp = await this.send(cmdReadPreset(this.devAddr), ctx?.signal, true);
      // 实测返回 1 字节裸数据: preset (无帧头). 0=F00, 1-12=U01-U12
      const preset = resp.length >= 1 ? resp[0] : 0;
      return { preset };
    });
  }

  /** 矩阵单点路由 (Out X ← In Y) */
  async setMatrix(out: ChannelIndex, input: ChannelIndex, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ out: number; input: number; on: boolean }>> {
    return this.run('audio-dsp', `setMatrix_O${out}_I${input}_${on ? 'on' : 'off'}`, ctx, async () => {
      await this.send(cmdSetMatrix(this.devAddr, out, input, on), ctx?.signal);
      this.appliedMatrix[out][input] = on; // 同步增量缓存
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
      // 实测裸响应 (无帧头): readLevel 返 3 字节 [IO, Ch, level], level 在 payload[2]
      const db = resp.length >= 3 ? levelByteToDb(resp[2]) : -128;
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
  /** 委托给协议层的单一真源 —— controller 存"期望增益"用的是同一个函数, 见那边说明 */
  private percentToDb(percent: number): number {
    return protoPercentToDb(percent);
  }

  /**
   * 读取通道当前状态 (合成 AudioState).
   * 实测裸响应 (无帧头):
   *   readGain → 4 字节 [IO, Ch, HI, LO]  code = HI<<8|LO, codeToDb 换算
   *   readMute → 3 字节 [IO, Ch, mute]
   * 给后台/状态面板用, 写命令不再走这里 (避免连发连接被 EKX 拒).
   */
  private async readState(ch: ChannelIndex, signal?: AbortSignal): Promise<AudioState> {
    let volume = 0;
    let muted = false;
    try {
      const gainResp = await this.send(cmdReadGain(this.devAddr, IO_OUT, ch), signal, true);
      if (gainResp.length >= 4) {
        const db = codeToDb(gainResp[2], gainResp[3]);
        volume = Math.round(this.dbToPercent(db));
      }
    } catch {
      /* 读取失败不阻塞主路径 */
    }
    try {
      const muteResp = await this.send(cmdReadMute(this.devAddr, IO_OUT, ch), signal, true);
      if (muteResp.length >= 3) muted = muteResp[2] === 1;
    } catch {
      /* 同上 */
    }
    return { volume, muted, bgm: null, micEnabled: false };
  }

  /**
   * 输入通路诊断 — 读某路输入的真实增益/静音, 以及它到 8 路输出的真实路由.
   *
   * 为什么需要它 (2026-07-16 现场):
   *   "BGM 从 3.5mm 出来了、GK9000 也能听见, 但矩阵收不到" 这类问题, 光读电平
   *   表判断不了 —— EKX 预设常把输入增益压到 -60dB, 信号进来了也会被压成本底
   *   噪声 (IN1 读数恒 -70dB), 看起来跟"没接线"一模一样。
   *   而 GET /api/audio/matrix/state 读的是本地 JSON 文件, 不是设备状态。
   *   这里直接问设备: 增益多少 / 静音没 / 路由通没通。
   */
  async diagnoseInput(channel: ChannelIndex, ctx?: AdapterContext): Promise<AdapterResult<{
    channel: number;
    gainDb: number | null;
    muted: boolean | null;
    level: number | null;
    routedTo: number[];
  }>> {
    return this.run('audio-dsp', `diagnoseInput_${channel}`, ctx, async () => {
      let gainDb: number | null = null;
      let muted: boolean | null = null;
      let level: number | null = null;
      const routedTo: number[] = [];

      try {
        const g = await this.send(cmdReadGain(this.devAddr, IO_IN, channel), ctx?.signal, true);
        if (g.length >= 4) gainDb = codeToDb(g[2], g[3]);
      } catch { /* 读不到就留 null, 不阻塞其它项 */ }

      try {
        const m = await this.send(cmdReadMute(this.devAddr, IO_IN, channel), ctx?.signal, true);
        if (m.length >= 3) muted = m[2] === 1;
      } catch { /* 同上 */ }

      try {
        const l = await this.send(cmdReadLevel(this.devAddr, 0, channel), ctx?.signal, true);
        if (l.length >= 3) level = levelByteToDb(l[2]);
      } catch { /* 同上 */ }

      // 逐格问设备这路输入接到了哪些输出 (单客户端设备, send 已串行排队)
      for (let out = 0; out < 8; out += 1) {
        try {
          const c = await this.send(
            cmdReadMatrixCell(this.devAddr, out as ChannelIndex, channel), ctx?.signal, true,
          );
          // 返回 [outCh, inCh, on]
          if (c.length >= 3 && c[2] === 1) routedTo.push(out);
        } catch { /* 单格读失败不影响其它格 */ }
      }

      return { channel, gainDb, muted, level, routedTo };
    });
  }

  /** dB → 百分比 (反向, 仅用于状态回读) */
  private dbToPercent(db: number): number {
    if (db <= -60) return 0;
    if (db >= 12) return 100;
    if (db < -10) return ((db + 60) / 50) * 50;
    return 50 + ((db + 10) / 22) * 50;
  }

  /**
   * 调试: 发任意 hex frame, 拿 raw response.
   * hex 形如 "7B 7D 01 48 01 00 00 7D 7B" 或 "7B7D01480100007D7B"
   */
  async debugSendRaw(hex: string): Promise<{ sent: string; received: string; receivedBytes: number }> {
    await this.syncRuntime();
    const clean = (hex || '').replace(/\s+/g, '');
    if (clean.length === 0) throw new Error('hex 必填');
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
      throw new Error('hex 格式错: 必须为偶数个 [0-9a-f] 字符');
    }
    const buf = Buffer.from(clean, 'hex') as Buffer;
    // 走 send() (经串行锁 + keepAlive + sendAndReadAll), 跟真实命令同一条路径,
    // 这样 debug/raw 拿到的就是 backend 真实读取行为.
    const received: Buffer = await this.send(buf, undefined, true);
    return {
      sent: [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      received: [...received].map((b) => b.toString(16).padStart(2, '0')).join(' '),
      receivedBytes: received.length,
    };
  }

  /**
   * 调试: UDP 发 hex frame 到指定端口. 用于排查 EKX 实际是不是 UDP 协议.
   */
  async debugSendUdp(hex: string, host: string, port: number, timeoutMs: number): Promise<{ sent: string; received: string; receivedBytes: number; from?: string }> {
    const clean = (hex || '').replace(/\s+/g, '');
    if (clean.length === 0) throw new Error('hex 必填');
    if (!/^[0-9a-fA-F]+$/.test(clean) || clean.length % 2 !== 0) {
      throw new Error('hex 格式错: 必须为偶数个 [0-9a-f] 字符');
    }
    const buf = Buffer.from(clean, 'hex') as Buffer;
    const dgram = await import('dgram');
    return new Promise((resolve, reject) => {
      const sock = dgram.createSocket('udp4');
      let timer: ReturnType<typeof setTimeout> | null = null;
      const cleanup = () => { if (timer) clearTimeout(timer); try { sock.close(); } catch { /* ignore */ } };
      sock.on('message', (msg, rinfo) => {
        cleanup();
        resolve({
          sent: [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' '),
          received: [...msg].map((b) => b.toString(16).padStart(2, '0')).join(' '),
          receivedBytes: msg.length,
          from: `${rinfo.address}:${rinfo.port}`,
        });
      });
      sock.on('error', (err) => { cleanup(); reject(err); });
      sock.bind(0, () => {
        sock.send(buf, port, host, (err) => {
          if (err) { cleanup(); reject(err); return; }
          timer = setTimeout(() => {
            cleanup();
            resolve({
              sent: [...buf].map((b) => b.toString(16).padStart(2, '0')).join(' '),
              received: '',
              receivedBytes: 0,
              from: '(timeout, no response)',
            });
          }, timeoutMs);
        });
      });
    });
  }

  /**
   * 单条命令发送 (带重试), 返回设备的**变长裸响应字节**.
   *
   * EKX-808 实测协议 (2026-06-13 现场抓包):
   *   - 写命令 (setVolume/mute/recallScene/matrix) → 返 "OK" = [0x4F, 0x4B]
   *   - readGain   → 4 字节 [IO, Ch, HI, LO]  (code = HI<<8 | LO)
   *   - readMute   → 3 字节 [IO, Ch, mute]
   *   - readPreset → 1 字节 [preset]
   *   响应**没有 7B7D 帧头帧尾**, 长度不定. 所以不能用 sendAndExpect(固定9字节),
   *   改用 sendAndReadAll: 写完后收齐"安静窗口"内所有字节再返回.
   *
   * EKX 单客户端 + 短连接: 每条命令开一个 TCP 连接发完读完就关, 释放给厂家 PC 软件
   * (调试时业主可能要连). expectResponse 参数保留兼容, 现在统一都读响应.
   */
  private async send(payload: Buffer, signal?: AbortSignal, _expectResponse = false): Promise<Buffer> {
    // 串行锁: 所有命令排队, 任意时刻只有一个 TCP 连接 (EKX 单客户端, 并发必废).
    const run = async (): Promise<Buffer> => {
      await this.syncRuntime();
      try {
        const result = await withRetry(
          // settle 200ms (收到末字节后静默 200ms 即认为发完), 整体上限 1200ms
          async () => this.tcp.sendAndReadAll(payload, 200, 1200, signal),
          { retries: this.retries, timeoutMs: this.timeoutMs, signal },
        );
        this.registry.markOnline(GATEWAY_KEY);
        return result;
      } catch (err) {
        const dErr = classifyError('audio', err);
        this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
        throw dErr;
      }
    };
    const next = this.cmdLock.then(run, run);
    // 锁链不被单次失败打断 (吞掉 rejection 只为续锁; 真实结果仍由 next 抛出)
    this.cmdLock = next.then(() => undefined, () => undefined);
    return next;
  }
}
