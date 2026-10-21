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
import { classifyError, DeviceProtocolError } from '../errors';
import { withRetry } from '../retry';
import { SerialPortClient } from './serial-port-client';
import {
  cmdChannelSwitch, cmdSequentialAll, cmdSyncAll, cmdReadAddr, cmdReadStatus,
  tryParseReply, parseStatusReply, SEQ55_DEFAULT_ADDR, SEQ55_DEFAULT_BAUD,
  type Seq55Channel, type Seq55ChannelStatus,
} from './seq55-protocol';

const GATEWAY_KEY = 'power-seq55';

// 下发后回读校验（第三十五轮加固）：F0/F1 是 set 语义但设备对 set 不回帧，
// 必须再发 FA 读位图确认目标通道真的动作，避免「写帧后即返回」的假成功。
const SINGLE_VERIFY_ATTEMPTS = 3; // 单路：下发+回读最多尝试次数
const SINGLE_VERIFY_WAIT_MS = 1200; // 单路：下发后等待继电器动作并匹配的窗口
const SINGLE_VERIFY_POLL_MS = 300; // 单路：窗口内 FA 回读轮询间隔
const ALL_SEQ_VERIFY_ATTEMPTS = 2; // 0D 时序全开/关：最多尝试次数
const ALL_SEQ_VERIFY_WAIT_MS = 6000; // 0D 时序：8 路按内部时序逐路动作，留足窗口
const ALL_SEQ_VERIFY_POLL_MS = 500;
const ALL_SYNC_VERIFY_WAIT_MS = 1500; // 10 同步：几乎同时动作，窗口短
const ALL_SYNC_VERIFY_POLL_MS = 300;

/**
 * 第二台 8 路电源时序器 ("55…AA" 6 字节协议) 适配器 — 2026-07-29 业主计划加装,
 * **先写好等设备到货**。协议与在用的 EPO-802P 完全不同 (帧头 55 vs 5A5A5A,
 * 波特率 9600 vs 19200), 见 seq55-protocol.ts 头注释。
 *
 * 接线待定: 不能与 EPO 共用 COM1 (波特率不同)。串口号从 DB 读
 * (hardware_unit category='power-seq55' 的 ip 字段填 "COM2" 之类), 没配退
 * env POWER_SEQ55_PORT_PATH, 默认 COM2。到货后在后台设备管理里建这台硬件
 * (或跑种子), 电源回路挂 gatewayCode 指向它即可上电源页。
 *
 * 已实现读状态 (FA)：2026-10-18 COM4@9600 实测回 `55 addr bitmap 00 F5 AA`，
 * readStatus 解析为 8 路位图（bit0=CH1 为约定，待一次授权单路对照最终确认）。
 *
 * ⚠️ 面板电源按键必须关闭状态才受串口控制 (厂家注明), 安装时要交代现场。
 */
@Injectable()
export class Seq55Adapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private serial: SerialPortClient | null = null;
  private portPath: string;
  private baudRate: number;
  private devAddr: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private endpoint = '';

  private dbCache: { path?: string; baud?: number; addr?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  /** 串口独占 + 无帧边界 → 所有命令排队, 一次只有一个往返 (同 EPO 的锁) */
  private cmdLock: Promise<unknown> = Promise.resolve();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.portPath = process.env.POWER_SEQ55_PORT_PATH ?? 'COM2';
    this.baudRate = Number.parseInt(process.env.POWER_SEQ55_BAUD ?? String(SEQ55_DEFAULT_BAUD), 10);
    this.devAddr = Number.parseInt(process.env.POWER_SEQ55_ADDR ?? String(SEQ55_DEFAULT_ADDR), 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
  }

  /** DB 配置: hardware_unit category='power-seq55', ip 存串口号, addressing 存 {baud, devAddr} */
  private async getConfigFromDb(): Promise<{ path?: string; baud?: number; addr?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { path: this.dbCache.path, baud: this.dbCache.baud, addr: this.dbCache.addr };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { category: 'power-seq55' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let baud: number | undefined;
      let addr: number | undefined;
      if (row.addressing) {
        try {
          const a = JSON.parse(row.addressing) as { baud?: number; devAddr?: number };
          baud = a.baud;
          addr = a.devAddr;
        } catch { /* addressing 不是 JSON 也 OK */ }
      }
      const path = row.ip && /^COM\d+$/i.test(row.ip.trim()) ? row.ip.trim().toUpperCase() : undefined;
      this.dbCache = { path, baud, addr, at: now };
      return { path, baud, addr };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'Seq55Adapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  invalidateConfigCache(): void {
    this.dbCache = { at: 0 };
    this.serial = null;
  }

  private async ensureClient(): Promise<SerialPortClient> {
    const db = await this.getConfigFromDb();
    const path = db?.path ?? process.env.POWER_SEQ55_PORT_PATH ?? 'COM2';
    const baud = db?.baud ?? Number.parseInt(process.env.POWER_SEQ55_BAUD ?? String(SEQ55_DEFAULT_BAUD), 10);
    this.devAddr = db?.addr ?? Number.parseInt(process.env.POWER_SEQ55_ADDR ?? String(SEQ55_DEFAULT_ADDR), 10);

    if (this.serial && path === this.portPath && baud === this.baudRate) return this.serial;

    if (this.serial) {
      this.logger.info(
        `Seq55Adapter rewiring: ${this.portPath}@${this.baudRate} → ${path}@${baud}`,
        { context: 'Seq55Adapter' },
      );
    }
    this.portPath = path;
    this.baudRate = baud;
    this.endpoint = `serial://${path}@${baud}`;
    this.serial = new SerialPortClient({
      path,
      baudRate: baud,
      deviceType: 'power',
      timeoutMs: this.timeoutMs,
    });
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
    return this.serial;
  }

  private async send(frame: Buffer, signal?: AbortSignal, expectReply = false): Promise<Buffer> {
    const run = async (): Promise<Buffer> => {
      const serial = await this.ensureClient();
      try {
        const resp = await withRetry(
          () => serial.request(frame, { expectReply, signal }),
          { retries: this.retries, timeoutMs: this.timeoutMs, signal },
        );
        this.registry.markOnline(GATEWAY_KEY);
        return resp;
      } catch (err) {
        const dErr = classifyError('power', err);
        this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
        throw dErr;
      }
    };
    const queued = this.cmdLock.then(run, run);
    this.cmdLock = queued.catch(() => undefined);
    return queued;
  }

  private assertChannel(ch: number): Seq55Channel {
    if (!Number.isInteger(ch) || ch < 1 || ch > 8) {
      throw new DeviceProtocolError('power', `seq55 通道号需为 1-8, got ${ch}`);
    }
    return ch as Seq55Channel;
  }

  private sleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) { reject(signal.reason ?? new Error('aborted')); return; }
      const t = setTimeout(resolve, ms);
      signal?.addEventListener('abort', () => {
        clearTimeout(t);
        reject(signal.reason ?? new Error('aborted'));
      }, { once: true });
    });
  }

  /**
   * 下发后轮询 FA 回读，直到 8 路位图满足 predicate（或超过 waitMs）。
   * 走 this.send（cmdLock 串行队列 + 常驻短连接），不独立打开 COM4，避免与 10s 采集争用。
   * 单次读失败不立即抛错（继电器动作中回帧可能不完整），在窗口内继续轮询。
   */
  private async pollStatusUntil(
    predicate: (channels: boolean[]) => boolean,
    waitMs: number,
    pollMs: number,
    ctx?: AdapterContext,
  ): Promise<{ matched: boolean; reply: Buffer; channels?: boolean[] }> {
    const deadline = Date.now() + waitMs;
    let reply: Buffer<ArrayBufferLike> = Buffer.alloc(0);
    let channels: boolean[] | undefined;
    while (Date.now() < deadline) {
      if (ctx?.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
      try {
        reply = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, true);
        const parsed = parseStatusReply(reply);
        if (parsed.ok && parsed.channels) {
          channels = parsed.channels;
          if (predicate(channels)) return { matched: true, reply, channels };
        }
      } catch (err) {
        // 轮询窗口内的读失败记一笔，继续读到 deadline；窗口结束仍未匹配再由调用方判定
        this.logger.debug(`seq55 FA 回读异常(继续轮询): ${(err as Error).message}`, { context: 'Seq55Adapter' });
      }
      const left = deadline - Date.now();
      if (left <= 0) break;
      await this.sleep(Math.min(pollMs, left), ctx?.signal);
    }
    return { matched: false, reply, channels };
  }

  /** 字节级状态摘要，用于回读不符时的日志（set 帧 / FA 回帧 / 位图）。 */
  private static describeChannels(channels?: boolean[]): string {
    return channels ? channels.map((c) => (c ? 1 : 0)).join('') : 'n/a';
  }

  /** 单路通断：下发 F0/F1 → 轮询 FA 回读确认目标路位图，不符则重发，仍不符抛错。 */
  async setChannel(channel: number, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; on: boolean }>> {
    return this.run(`seq55-ch${channel}`, on ? 'channelOn' : 'channelOff', ctx, async () => {
      const ch = this.assertChannel(channel);
      let lastDetail = '';
      for (let attempt = 1; attempt <= SINGLE_VERIFY_ATTEMPTS; attempt += 1) {
        if (ctx?.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
        const setFrame = cmdChannelSwitch(this.devAddr, ch, on);
        await this.send(setFrame, ctx?.signal, false);
        const r = await this.pollStatusUntil(
          (cs) => cs[ch - 1] === on,
          SINGLE_VERIFY_WAIT_MS,
          SINGLE_VERIFY_POLL_MS,
          ctx,
        );
        if (r.matched) {
          if (attempt > 1) {
            this.logger.info(`seq55 ch${ch} ${on ? '开' : '关'} 第 ${attempt} 次回读确认成功`, { context: 'Seq55Adapter' });
          }
          return { channel, on };
        }
        lastDetail = `set=${setFrame.toString('hex')} reply=${r.reply.toString('hex')} `
          + `bitmap=[${Seq55Adapter.describeChannels(r.channels)}] expect ch${ch}=${on ? 1 : 0}`;
        this.logger.warn(`seq55 ch${ch} ${on ? '开' : '关'} 回读未确认(第 ${attempt} 次): ${lastDetail}`, { context: 'Seq55Adapter' });
      }
      this.logger.error(`seq55 ch${ch} ${on ? '开' : '关'} 下发后 ${SINGLE_VERIFY_ATTEMPTS} 次回读均未确认: ${lastDetail}`, { context: 'Seq55Adapter' });
      throw new DeviceProtocolError(
        'power',
        `seq55 第 ${ch} 路${on ? '开' : '关'}后回读状态不符（${SINGLE_VERIFY_ATTEMPTS} 次）；`
        + '请确认面板电源键处于关闭(受控)状态、该路接线正常。',
      );
    });
  }

  /** 8 路顺序开/关 (0D) — 时序保护, 全开全关优先用它；下发后轮询回读直到 8 路全部到位。 */
  async setAllSequential(on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ on: boolean }>> {
    return this.run('seq55-all', on ? 'seqAllOn' : 'seqAllOff', ctx, async () => {
      let lastDetail = '';
      for (let attempt = 1; attempt <= ALL_SEQ_VERIFY_ATTEMPTS; attempt += 1) {
        if (ctx?.signal?.aborted) throw ctx.signal.reason ?? new Error('aborted');
        const frame = cmdSequentialAll(this.devAddr, on);
        await this.send(frame, ctx?.signal, false);
        const r = await this.pollStatusUntil(
          (cs) => cs.length === 8 && cs.every((c) => c === on),
          ALL_SEQ_VERIFY_WAIT_MS,
          ALL_SEQ_VERIFY_POLL_MS,
          ctx,
        );
        if (r.matched) return { on };
        lastDetail = `set=${frame.toString('hex')} reply=${r.reply.toString('hex')} bitmap=[${Seq55Adapter.describeChannels(r.channels)}]`;
        this.logger.warn(`seq55 时序全${on ? '开' : '关'} 回读未全部到位(第 ${attempt} 次): ${lastDetail}`, { context: 'Seq55Adapter' });
      }
      this.logger.error(`seq55 时序全${on ? '开' : '关'} ${ALL_SEQ_VERIFY_ATTEMPTS} 次回读未全部到位: ${lastDetail}`, { context: 'Seq55Adapter' });
      throw new DeviceProtocolError('power', `seq55 时序全${on ? '开' : '关'}后回读 8 路未全部到位（${ALL_SEQ_VERIFY_ATTEMPTS} 次）；请确认面板电源键处于关闭(受控)状态。`);
    });
  }

  /** 8 路同步全开/全关 (10) — 无时序, 慎用 (浪涌)；同样回读确认。 */
  async setAllSync(on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ on: boolean }>> {
    return this.run('seq55-all', on ? 'syncAllOn' : 'syncAllOff', ctx, async () => {
      const frame = cmdSyncAll(this.devAddr, on);
      await this.send(frame, ctx?.signal, false);
      const r = await this.pollStatusUntil(
        (cs) => cs.length === 8 && cs.every((c) => c === on),
        ALL_SYNC_VERIFY_WAIT_MS,
        ALL_SYNC_VERIFY_POLL_MS,
        ctx,
      );
      if (r.matched) return { on };
      const detail = `set=${frame.toString('hex')} reply=${r.reply.toString('hex')} bitmap=[${Seq55Adapter.describeChannels(r.channels)}]`;
      this.logger.error(`seq55 同步全${on ? '开' : '关'} 回读未到位: ${detail}`, { context: 'Seq55Adapter' });
      throw new DeviceProtocolError('power', `seq55 同步全${on ? '开' : '关'}后回读 8 路未全部到位。`);
    });
  }

  /**
   * 读 8 路实时状态 (FA) — 只读、短往返。返回 `55 addr bitmap 00 F5 AA`，
   * 由 parseStatusReply 解析为 channels[8]（bit0=CH1，待单路对照最终锁定）。
   * 现场 2026-10-18 实测全亮回 `55 01 FF 00 F5 AA`。
   */
  async readStatus(ctx?: AdapterContext): Promise<AdapterResult<Seq55ChannelStatus>> {
    return this.run(GATEWAY_KEY, 'readStatus', ctx, async () => {
      const resp = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, true);
      const parsed = parseStatusReply(resp);
      if (!parsed.ok || !parsed.channels) {
        throw new DeviceProtocolError(
          'power',
          `seq55 状态帧解析失败: ${parsed.error ?? resp.toString('hex')}`,
        );
      }
      return { channels: parsed.channels };
    });
  }

  /**
   * 探活: 读地址 (FB) 期待任意回帧。8 路开关状态请用 readStatus (FA)。
   */
  async ping(ctx?: AdapterContext): Promise<void> {
    const resp = await this.send(cmdReadAddr(this.devAddr), ctx?.signal, true);
    if (!tryParseReply(resp).valid) {
      throw new DeviceProtocolError('power', `seq55 无有效回帧: ${resp.toString('hex')}`);
    }
    this.registry.markOnline(GATEWAY_KEY);
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      await this.ping(ctx);
      return { ok: true as const };
    });
  }

}
