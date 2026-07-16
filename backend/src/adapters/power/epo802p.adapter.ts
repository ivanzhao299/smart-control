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
  cmdAllChannels,
  cmdChannelDelay,
  cmdChannelSwitch,
  cmdMasterKey,
  cmdReadStatus,
  parseStatus,
  type Epo802pStatus,
  type PowerChannel,
} from './epo802p-protocol';

const GATEWAY_KEY = 'power-epo802p';

/**
 * 得胜 TAKSTAR EPO-802P 8 路电源时序器适配器
 *
 * 协议: 厂家《EPO-802P 中控指令表》, 串口 **19200 8N1**。
 * 组帧逻辑在 epo802p-protocol.ts, 已用文档里全部 10 个官方例子逐字节比对通过。
 *
 * 接线 (2026-07-16 现场实测确认): **GK9000 板载 COM1 直连**, 不是串口服务器转
 * TCP。实测 `ac` 读状态回 137 字节, 8 路状态 + 延时参数 + 过压(250V)/欠压(150V)
 * 全部解析正确。
 *
 * 串口号从 DB 读 (hardware_unit category='audio-power' 的 ip 字段填 "COM1"),
 * 没配就退回 env POWER_EPO_PORT_PATH, 默认 COM1。
 *
 * 通道对应: PowerCircuit.relayChannel (1-8) 直接就是时序器的通道号。
 *
 * ⚠️ 两个要点:
 *   1. **时序**: 全开/全关走 b3 (cmdAllChannels) 让设备按各路延时依次动作, 保护
 *      功放不被浪涌打坏。绝不在这边 for 循环发 8 次 b2 —— 那样丧失时序保护。
 *   2. **串口独占**: COM 口同一时刻只能被一个进程打开, 所以用短连接 (每次命令
 *      开-发-收-关), 不长期占着 —— 否则现场想用厂家工具调试就打不开了。
 *      注意 COM7 是现场调 DALI 网关的 USB 转串口, 别碰。
 */
@Injectable()
export class Epo802pAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private serial: SerialPortClient | null = null;
  /** 串口号, e.g. 'COM1' */
  private portPath: string;
  private baudRate: number;
  private devAddr: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private endpoint = '';

  /** DB 配置缓存, 5s TTL (跟其它适配器一致) */
  private dbCache: { path?: string; baud?: number; addr?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  /**
   * 命令串行锁 — COM 口是独占资源, 且串口无帧边界, 并发发帧会互相插队导致收发
   * 错位 (EKX 那边踩过同样的坑)。所有 send 经这把锁排队, 保证一次只有一个往返。
   */
  private cmdLock: Promise<unknown> = Promise.resolve();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.portPath = process.env.POWER_EPO_PORT_PATH ?? 'COM1';
    this.baudRate = Number.parseInt(process.env.POWER_EPO_BAUD ?? '19200', 10);
    this.devAddr = Number.parseInt(process.env.POWER_EPO_ADDR ?? '0', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
  }

  /**
   * 查 DB 里 audio-power 那条硬件记录. 5s TTL.
   * 串口设备没有 IP — 复用 `ip` 字段存串口号 ("COM1"), addressing 存 {baud, devAddr}。
   * 这样后台「设备网络」页改串口号也能生效, 不用改代码。
   */
  private async getConfigFromDb(): Promise<{ path?: string; baud?: number; addr?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { path: this.dbCache.path, baud: this.dbCache.baud, addr: this.dbCache.addr };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { category: 'audio-power' } });
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
      // ip 字段存的是串口号 (COM1); 不像 COM 口的值 (比如遗留的 IP) 一律忽略
      const path = row.ip && /^COM\d+$/i.test(row.ip.trim()) ? row.ip.trim().toUpperCase() : undefined;
      this.dbCache = { path, baud, addr, at: now };
      return { path, baud, addr };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'Epo802pAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  /** 后台改完串口号调这个, 下次命令就用新口 */
  invalidateConfigCache(): void {
    this.dbCache = { at: 0 };
    this.serial = null;
  }

  /** 每次发命令前: DB > env > default 三级取串口号/波特率, 变了就重建 */
  private async ensureClient(): Promise<SerialPortClient> {
    const db = await this.getConfigFromDb();
    const path = db?.path ?? process.env.POWER_EPO_PORT_PATH ?? 'COM1';
    const baud = db?.baud ?? Number.parseInt(process.env.POWER_EPO_BAUD ?? '19200', 10);
    this.devAddr = db?.addr ?? Number.parseInt(process.env.POWER_EPO_ADDR ?? '0', 10);

    if (this.serial && path === this.portPath && baud === this.baudRate) return this.serial;

    if (this.serial) {
      this.logger.info(
        `Epo802pAdapter rewiring: ${this.portPath}@${this.baudRate} → ${path}@${baud}`,
        { context: 'Epo802pAdapter' },
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

  /**
   * 串行发帧; expectReply=true 时读回响应.
   *
   * 串口没有帧边界, SerialPortClient 靠"静默 250ms"判定收完 —— 实测 ac 回 137
   * 字节 (8 路状态 + 8×4 延时 + 过压/欠压 + 若干参数), 一次就能收全。
   */
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

  private assertChannel(ch: number): PowerChannel {
    if (!Number.isInteger(ch) || ch < 1 || ch > 8) {
      throw new DeviceProtocolError('power', `EPO-802P 通道号需为 1-8, got ${ch}`);
    }
    return ch as PowerChannel;
  }

  /** 单路通断 */
  async setChannel(channel: number, on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ channel: number; on: boolean }>> {
    return this.run(`epo-ch${channel}`, on ? 'channelOn' : 'channelOff', ctx, async () => {
      const ch = this.assertChannel(channel);
      await this.send(cmdChannelSwitch(this.devAddr, ch, on), ctx?.signal);
      return { channel, on };
    });
  }

  /**
   * 全部通道通断 (b3) — 设备按各路设定延时**依次**动作, 这才是时序器的正确用法.
   * 别在调用方 for 循环发 8 次 b2, 那样会丧失时序保护。
   */
  async setAll(on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ on: boolean }>> {
    return this.run('epo-all', on ? 'allOn' : 'allOff', ctx, async () => {
      await this.send(cmdAllChannels(this.devAddr, on), ctx?.signal);
      return { on };
    });
  }

  /** 总按键 (b1) — 等效面板总开关 */
  async masterKey(on: boolean, ctx?: AdapterContext): Promise<AdapterResult<{ on: boolean }>> {
    return this.run('epo-master', on ? 'masterOn' : 'masterOff', ctx, async () => {
      await this.send(cmdMasterKey(this.devAddr, on), ctx?.signal);
      return { on };
    });
  }

  /** 读 8 路真实状态 + 延时参数 (ac) */
  async readStatus(ctx?: AdapterContext): Promise<AdapterResult<Epo802pStatus>> {
    return this.run('epo-status', 'readStatus', ctx, async () => {
      const resp = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, true);
      const st = parseStatus(resp);
      if (!st) {
        throw new DeviceProtocolError('power', `EPO-802P 状态帧解析失败: ${resp.toString('hex')}`);
      }
      return st;
    });
  }

  /** 设置某路的开/关延时 (秒, 0-1000) */
  async setDelay(
    channel: number,
    kind: 'on' | 'off',
    seconds: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ channel: number; kind: string; seconds: number }>> {
    return this.run(`epo-ch${channel}`, `setDelay_${kind}`, ctx, async () => {
      const ch = this.assertChannel(channel);
      await this.send(cmdChannelDelay(this.devAddr, ch, kind, seconds), ctx?.signal);
      return { channel, kind, seconds };
    });
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    const resp = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, true);
    if (!parseStatus(resp)) {
      throw new DeviceProtocolError('power', 'EPO-802P 无有效状态响应');
    }
    this.registry.markOnline(GATEWAY_KEY);
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      await this.ping(ctx);
      return { ok: true as const };
    });
  }

  /** P2 — 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'takstar-epo802p',
      displayName: '得胜 EPO-802P 8 路电源时序器',
      vendor: '得胜 TAKSTAR',
      category: 'audio-power',
      protocol: 'serial',
      capabilities: ['turn_on', 'turn_off', 'get_status', 'health_check'],
      defaultAddressing: { baud: 19200, devAddr: 0, channels: 8 },
      paramSchema: {
        ip: { type: 'string', label: '串口号', required: true, placeholder: 'COM1' },
        baud: { type: 'number', label: '波特率', default: 19200, min: 1200, max: 115200 },
        devAddr: { type: 'number', label: '机器 ID', default: 0, min: 0, max: 255 },
      },
      remark: '8 路时序上电保护功放. GK9000 板载 COM1 直连, 19200 8N1. 全开/全关走 b3 由设备按延时依次动作.',
    };
  }
}
