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
import { ModbusRtuClient } from '../transports/modbus-rtu';
import {
  CTRL,
  MOTOR_OP,
  DATA_BASE,
  DATA_WORD_COUNT,
  WORD,
  decodeSwitchState,
  decodeMeasurements,
  type SwitchState,
  type BreakerMeasurements,
} from './epa-breaker-registers';

const GATEWAY_KEY = 'power-epa-breaker';

export interface BreakerState {
  /** 合闸(送电)= true, 分闸(断电)= false */
  on: boolean;
  switchState: SwitchState;
}

/**
 * ePa 智能断路器 / 远程空开适配器 —— RS485 标准 Modbus-RTU, 经有人 RTU-TCP 转换器接入。
 *
 * 用于给 LED 大屏(19KW/三相)做远程物理总闸: 合闸/分闸 + 计量(电压/电流/功率/温度/漏电)。
 * 协议编解码在 epa-breaker-registers.ts(已 16 个金标准测试), 走 ModbusRtuClient 收发,
 * 跟 cy-dali64a 是同一套路(裸 Modbus RTU + CRC16 灌进有人转换器)。
 *
 * 【当前状态: 就绪待联调】
 * 协议层已验证, adapter 结构完整, mock 路径可跑。但设备和转换器**还没到货**, 所以:
 *   - 暂不注册为 NestJS provider、不接进 PowerAdapter 的执行路由(那要动执行主干,
 *     且无真机无法验证)
 *   - DriverRegistryService 只调它的 static describe(), 让它出现在 driver 目录里
 * 真机到货后: 注册 provider + 接进 PowerAdapter + 在 hardware_unit 填转换器 IP, 即联调。
 *
 * 连接参数从 hardware_unit(category='power-breaker')的 ip + addressing 读, 5s TTL,
 * 后台改转换器 IP 不重启生效 —— 跟其它 adapter 一致。
 */
@Injectable()
export class EpaBreakerAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private modbus: ModbusRtuClient | null = null;
  private host = '';
  private port = 502;
  private slaveId = 1;
  private endpoint = '';

  private dbCache: { host?: string; port?: number; slaveId?: number; at: number } = { at: 0 };
  private readonly DB_CACHE_TTL_MS = 5000;
  private readonly timeoutMs: number;
  private readonly frameIntervalMs: number;

  /** mock 态: 一台断路器一个内存开关 */
  private mockOn = new Map<string, boolean>();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    @Optional() private readonly registry?: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    // 空开 485 是 115200(比 DALI 9600 快), 帧间隔可小; 文档没要求最小间隔, 给 50ms 保守
    this.frameIntervalMs = Number.parseInt(process.env.EPA_RTU_FRAME_INTERVAL_MS ?? '50', 10);
  }

  // ============ 对外命令 ============

  /** 合闸(送电) */
  async turnOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      if (this.isMock()) {
        this.mockOn.set(deviceId, true);
        return { on: true, switchState: 'closed' as SwitchState };
      }
      await this.writeOp(deviceId, MOTOR_OP.CLOSE, ctx?.signal);
      return { on: true, switchState: 'closed' as SwitchState };
    });
  }

  /** 分闸(断电) */
  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      if (this.isMock()) {
        this.mockOn.set(deviceId, false);
        return { on: false, switchState: 'open' as SwitchState };
      }
      await this.writeOp(deviceId, MOTOR_OP.OPEN, ctx?.signal);
      return { on: false, switchState: 'open' as SwitchState };
    });
  }

  /** 读开关状态(0x0027 低字节) */
  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BreakerState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      if (this.isMock()) {
        const on = this.mockOn.get(deviceId) ?? false;
        return { on, switchState: (on ? 'closed' : 'open') as SwitchState };
      }
      const modbus = await this.ensureClient();
      // 至少读 2 个寄存器(0x0026, 0x0027); 开关状态在 0x0027 低字节
      const words = await this.readWithFault(modbus, WORD.PF_FREQ, 2, ctx?.signal);
      const st = decodeSwitchState(words[1]);
      return { on: st === 'closed', switchState: st };
    });
  }

  /** 读全套计量(电压/电流/功率/温度/漏电/电气状态) */
  async getMeasurements(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BreakerMeasurements>> {
    return this.run(deviceId, 'getMeasurements', ctx, async () => {
      if (this.isMock()) {
        return this.mockMeasurements(deviceId);
      }
      const modbus = await this.ensureClient();
      const words = await this.readWithFault(modbus, DATA_BASE, DATA_WORD_COUNT, ctx?.signal);
      return decodeMeasurements(words);
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      if (this.isMock()) return { ok: true as const };
      const modbus = await this.ensureClient();
      await this.readWithFault(modbus, WORD.PF_FREQ, 2, ctx?.signal);
      return { ok: true as const };
    });
  }

  // ============ 内部 ============

  private async writeOp(deviceId: string, op: number, signal?: AbortSignal): Promise<void> {
    const modbus = await this.ensureClient();
    try {
      await modbus.writeSingleRegister(CTRL.MOTOR_OP, op, this.slaveId, signal);
      this.registry?.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('power', err);
      this.registry?.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async readWithFault(
    modbus: ModbusRtuClient,
    address: number,
    qty: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    try {
      const out = await modbus.readHoldingRegisters(address, qty, this.slaveId, signal);
      this.registry?.markOnline(GATEWAY_KEY);
      return out;
    } catch (err) {
      const dErr = classifyError('power', err);
      this.registry?.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  /** DB > env > default 三级取连接参数, 变了就重建 client(热切换) */
  private async ensureClient(): Promise<ModbusRtuClient> {
    const db = await this.getConfigFromDb();
    const host = db?.host ?? process.env.EPA_RTU_HOST ?? '192.168.50.21';
    const port = db?.port ?? Number.parseInt(process.env.EPA_RTU_PORT ?? '502', 10);
    this.slaveId = db?.slaveId ?? Number.parseInt(process.env.EPA_RTU_SLAVE_ID ?? '1', 10);

    if (this.modbus && host === this.host && port === this.port) return this.modbus;

    if (this.modbus) {
      this.logger.info(`EpaBreakerAdapter rewiring: ${this.host}:${this.port} → ${host}:${port}`, {
        context: 'EpaBreakerAdapter',
      });
    }
    this.host = host;
    this.port = port;
    this.endpoint = `tcp://${host}:${port}`;
    const tcp = new TcpClient({
      host,
      port,
      timeoutMs: this.timeoutMs,
      deviceType: 'power',
      keepAlive: true,
      idleTimeoutMs: 30_000,
    });
    this.modbus = new ModbusRtuClient(tcp, this.slaveId, this.frameIntervalMs);
    if (!this.isMock()) this.registry?.register(GATEWAY_KEY, this.endpoint);
    return this.modbus;
  }

  private async getConfigFromDb(): Promise<{ host?: string; port?: number; slaveId?: number } | null> {
    if (!this.hwRepo) return null;
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return { host: this.dbCache.host, port: this.dbCache.port, slaveId: this.dbCache.slaveId };
    }
    try {
      const row = await this.hwRepo.findOne({ where: { category: 'power-breaker' } });
      if (!row) {
        this.dbCache = { at: now };
        return null;
      }
      let port: number | undefined;
      let slaveId: number | undefined;
      if (row.addressing) {
        try {
          const a = JSON.parse(row.addressing) as { port?: number; slaveId?: number };
          port = a.port;
          slaveId = a.slaveId;
        } catch {
          /* addressing 不是 JSON 也 OK */
        }
      }
      this.dbCache = { host: row.ip ?? undefined, port, slaveId, at: now };
      return { host: row.ip ?? undefined, port, slaveId };
    } catch (err) {
      this.logger.warn(`getConfigFromDb 失败: ${(err as Error).message}`, { context: 'EpaBreakerAdapter' });
      this.dbCache = { at: now };
      return null;
    }
  }

  private mockMeasurements(deviceId: string): BreakerMeasurements {
    const on = this.mockOn.get(deviceId) ?? false;
    return {
      voltages: on ? [220.1, 219.8, 220.5] : [0, 0, 0],
      currents: on ? [28.9, 29.2, 28.6] : [0, 0, 0],
      leakageCurrent: 0.003,
      powers: on ? [6360, 6420, 6290, 19070] : [0, 0, 0, 0],
      energies: [1234.5, 1240.1, 1228.9, 3703.5],
      temperatures: [32.0, 31.5, 32.4, 30.8],
      powerFactor: 0.95,
      frequency: 50,
      mode: 0,
      switchState: on ? 'closed' : 'open',
      alarms: {
        overVoltage: [false, false, false],
        underVoltage: [false, false, false],
        overCurrent: [false, false, false],
        leakage: false,
        overPower: [false, false, false, false],
        overHeat: [false, false, false, false],
        overEnergy: [false, false, false, false],
        any: false,
      },
    };
  }

  /** 给 DriverRegistryService 注册进 driver 目录用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'epa-breaker',
      displayName: 'ePa 智能断路器 / 远程空开 (485 Modbus)',
      vendor: 'ePa',
      category: 'power-breaker',
      protocol: 'modbus-rtu',
      capabilities: ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'],
      defaultAddressing: { port: 502, slaveId: 1 },
      paramSchema: {
        ip: { type: 'string', label: 'RTU↔TCP 转换器 IP', required: true, placeholder: '192.168.50.21' },
        port: { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
        slaveId: { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
      },
      remark:
        '给大屏做远程物理总闸: 合闸/分闸 + 计量. 485 标准 Modbus-RTU(115200/8N1/CRC16), ' +
        '经有人 RTU-TCP 转换器接入(别与 DALI 那台共用, 波特率不同). 分合闸写寄存器 0x0101(1合/2分). ' +
        '就绪待联调: 协议层已金标准测试, 设备到货填 IP 即用.',
    };
  }
}
