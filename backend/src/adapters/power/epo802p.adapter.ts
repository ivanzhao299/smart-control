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
import { TcpClient } from '../transports/tcp-client';
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
 * 协议: 厂家《EPO-802P 中控指令表》, 串口 19200, 现场经**串口服务器**转 TCP
 * (跟 DALI 那台 USR 一个路子 — 时序器本身没有网口)。
 * 组帧逻辑在 epo802p-protocol.ts, 已用文档里全部 10 个官方例子逐字节比对通过。
 *
 * IP/端口从 DB 读 (hardware_unit category='audio-power'), 后台改完不用重启;
 * 没配就退回 env POWER_EPO_HOST / POWER_EPO_PORT。
 *
 * 通道对应: PowerCircuit.relayChannel (1-8) 直接就是时序器的通道号。
 *
 * ⚠️ 时序器的意义在"时序": 8 路按设定延时**依次**通断, 保护功放不被浪涌打坏。
 * 所以"全开/全关"务必走 b3 (cmdAllChannels) 让设备自己按延时跑, 不要在这边
 * for 循环逐路发 b2 —— 那样就丧失时序保护了。
 */
@Injectable()
export class Epo802pAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private tcp: TcpClient | null = null;
  private host: string;
  private port: number;
  private devAddr: number;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private endpoint = '';

  /** DB 配置缓存, 5s TTL (跟其它适配器一致) */
  private dbCache: { host?: string; port?: number; addr?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;

  /**
   * 命令串行锁 — 串口服务器后面是一根 RS232/485 总线, 并发发帧会互相插队导致
   * 收发错位 (EKX 那边踩过同样的坑)。所有 send 经这把锁排队。
   */
  private cmdLock: Promise<unknown> = Promise.resolve();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.host = process.env.POWER_EPO_HOST ?? '192.168.50.20';
    this.port = Number.parseInt(process.env.POWER_EPO_PORT ?? '502', 10);
    this.devAddr = Number.parseInt(process.env.POWER_EPO_ADDR ?? '0', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
  }

  /** 查 DB 里 audio-power 那条硬件记录, 拿 ip + addressing.port/devAddr. 5s TTL. */
  private async getConfigFromDb(): Promise<{ host?: string; port?: number; addr?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port, addr: this.dbCache.addr };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { category: 'audio-power' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      let addr: number | undefined;
      if (row.addressing) {
        try {
          const a = JSON.parse(row.addressing) as { port?: number; tcpPort?: number; devAddr?: number };
          port = a.port ?? a.tcpPort;
          addr = a.devAddr;
        } catch { /* addressing 不是 JSON 也 OK */ }
      }
      this.dbCache = { host: row.ip ?? undefined, port, addr, at: now };
      return { host: row.ip ?? undefined, port, addr };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'Epo802pAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  /** 后台改完 IP 调这个, 下次命令就用新地址 */
  invalidateConfigCache(): void {
    this.dbCache = { at: 0 };
    this.tcp?.dispose();
    this.tcp = null;
  }

  /** 每次发命令前: DB > env > default 三级取 host/port, 变了就重建连接 */
  private async ensureClient(): Promise<TcpClient> {
    const db = await this.getConfigFromDb();
    const host = db?.host ?? process.env.POWER_EPO_HOST ?? '192.168.50.20';
    const port = db?.port ?? Number.parseInt(process.env.POWER_EPO_PORT ?? '502', 10);
    const addr = db?.addr ?? Number.parseInt(process.env.POWER_EPO_ADDR ?? '0', 10);
    this.devAddr = addr;

    if (this.tcp && host === this.host && port === this.port) return this.tcp;

    if (this.tcp) {
      this.logger.info(
        `Epo802pAdapter rewiring: ${this.host}:${this.port} → ${host}:${port}`,
        { context: 'Epo802pAdapter' },
      );
      this.tcp.dispose();
    }
    this.host = host;
    this.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    this.tcp = new TcpClient({
      host,
      port,
      deviceType: 'power',
      timeoutMs: this.timeoutMs,
      // 串口服务器: 短连接更稳 (跟 EKX 一样, 长连接容易被设备侧掐)
      keepAlive: false,
    });
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
    return this.tcp;
  }

  /**
   * 串行发帧; expectBytes>0 时读回响应.
   *
   * ac 读状态的回帧长度: 帧头(3)+7 字段+len(2) + 缓冲区 + 校验(1)+帧尾(1)。
   * 缓冲区 = 8 路状态 + 8×4 延时 + 过压/欠压(4) + 若干 1B 参数 ≈ 50+ 字节。
   * 用 minBytes 宽松收 (串口服务器可能分片), 解析时按帧头定位, 不依赖精确长度。
   */
  private async send(frame: Buffer, signal?: AbortSignal, expectBytes = 0): Promise<Buffer> {
    const run = async (): Promise<Buffer> => {
      const tcp = await this.ensureClient();
      try {
        const resp = await withRetry(
          async () => {
            if (expectBytes > 0) {
              return tcp.sendAndExpect(frame, expectBytes, signal, { minBytes: 20 });
            }
            await tcp.send(frame, signal);
            return Buffer.alloc(0);
          },
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

  /** ac 状态回帧的预期长度 (见 send 注释) */
  private static readonly STATUS_REPLY_BYTES = 64;

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
      const resp = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, Epo802pAdapter.STATUS_REPLY_BYTES);
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
    const resp = await this.send(cmdReadStatus(this.devAddr), ctx?.signal, Epo802pAdapter.STATUS_REPLY_BYTES);
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
      protocol: 'serial-over-tcp',
      capabilities: ['turn_on', 'turn_off', 'get_status', 'health_check'],
      defaultAddressing: { port: 502, devAddr: 0, baud: 19200, channels: 8 },
      paramSchema: {
        ip: { type: 'string', label: '串口服务器 IP', required: true, placeholder: '192.168.50.x' },
        port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
        devAddr: { type: 'number', label: '机器 ID', default: 0, min: 0, max: 255 },
      },
      remark: '8 路时序上电保护功放. 串口 19200, 经串口服务器转 TCP. 全开/全关走 b3 由设备按延时依次动作.',
    };
  }
}
