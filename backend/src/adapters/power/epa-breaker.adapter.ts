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

interface BreakerConnectionConfig {
  host: string;
  port: number;
  slaveId: number;
}

interface BreakerTransport {
  tcp: TcpClient;
  modbus: ModbusRtuClient;
}

export interface BreakerState {
  /** 合闸(送电)= true, 分闸(断电)= false */
  on: boolean;
  switchState: SwitchState;
}

export interface BreakerAddressChange {
  oldSlaveId: number;
  newSlaveId: number;
  verified: boolean;
}

/**
 * ePa 智能断路器 / 远程空开适配器 —— RS485 标准 Modbus-RTU, 经有人 RTU-TCP 转换器接入。
 *
 * 用于给 LED 大屏(19KW/三相)做远程物理总闸: 合闸/分闸 + 计量(电压/电流/功率/温度/漏电)。
 * 协议编解码在 epa-breaker-registers.ts(已 16 个金标准测试), 走 ModbusRtuClient 收发,
 * 跟 cy-dali64a 是同一套路(裸 Modbus RTU + CRC16 灌进有人转换器)。
 *
 * 【当前状态: 2026-07-22 现场联调通过】
 * 硬件已装(断路器 + 有人 USR-DR304 转换器 192.168.50.21:502, TCP Server 透传, 115200/8N1)。
 * 已注册为 NestJS provider, PowerCircuitsService 按 gatewayCode → hardware_unit
 * (category='power-breaker') 路由到本 adapter, 分合闸与计量都走真机。
 *
 * **从机地址是 255(0xFF)**, 不是 1 —— 厂家实测帧 FF06010100010DE8 里的 FF 就是它的出厂地址,
 * 现场扫 1..247 全部无应答, 只有 255 应答。所以 paramSchema 的 slaveId 放开到 255。
 *
 * 每台断路器按 hardware_unit.code 精确寻址，连接参数从该行的 ip + addressing 读取。
 * 多台断路器可以共用一个 RTU-TCP 转换器，但必须配置不同 slaveId；相同 endpoint
 * 复用同一条串行通信队列，避免并发帧在同一条 485 总线上碰撞。
 */
@Injectable()
export class EpaBreakerAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  private readonly transports = new Map<string, BreakerTransport>();
  private readonly dbCache = new Map<string, { config: BreakerConnectionConfig; at: number }>();
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

  invalidateConfigCache(deviceId?: string): void {
    if (deviceId) this.dbCache.delete(deviceId);
    else this.dbCache.clear();
  }

  /** 合闸(送电) */
  async turnOn(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerState>> {
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
  async turnOff(
    deviceId: string,
    _p: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerState>> {
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
      const { modbus, slaveId } = await this.ensureClient(deviceId);
      // 至少读 2 个寄存器(0x0026, 0x0027); 开关状态在 0x0027 低字节
      const words = await this.readWithFault(
        deviceId,
        modbus,
        slaveId,
        WORD.PF_FREQ,
        2,
        ctx?.signal,
      );
      const st = decodeSwitchState(words[1]);
      return { on: st === 'closed', switchState: st };
    });
  }

  /** 读全套计量(电压/电流/功率/温度/漏电/电气状态) */
  async getMeasurements(
    deviceId: string,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerMeasurements>> {
    return this.run(deviceId, 'getMeasurements', ctx, async () => {
      if (this.isMock()) {
        return this.mockMeasurements(deviceId);
      }
      const { modbus, slaveId } = await this.ensureClient(deviceId);
      const words = await this.readWithFault(
        deviceId,
        modbus,
        slaveId,
        DATA_BASE,
        DATA_WORD_COUNT,
        ctx?.signal,
      );
      return decodeMeasurements(words);
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run(GATEWAY_KEY, 'healthCheck', ctx, async () => {
      if (this.isMock()) return { ok: true as const };
      const deviceIds = await this.enabledBreakerCodes();
      for (const deviceId of deviceIds) {
        const { modbus, slaveId } = await this.ensureClient(deviceId);
        await this.readWithFault(deviceId, modbus, slaveId, WORD.PF_FREQ, 2, ctx?.signal);
      }
      return { ok: true as const };
    });
  }

  /**
   * 修改物理断路器的 485 地址 (FC06 / 0x0103)，收到设备回显后同步硬件台账。
   * 新设备出厂都为 255 时，必须一次只接一台进行改址。
   */
  async changeSlaveId(
    deviceId: string,
    newSlaveId: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BreakerAddressChange>> {
    return this.run(deviceId, 'changeSlaveId', ctx, async () => {
      if (this.isMock()) throw new Error('模拟模式不允许修改物理 485 地址');
      if (!this.hwRepo) throw new Error('断路器硬件仓库未装载');
      const current = await this.getConfig(deviceId);
      const next = this.validateConfig(deviceId, { ...current, slaveId: newSlaveId });
      if (current.slaveId === next.slaveId) {
        return { oldSlaveId: current.slaveId, newSlaveId: next.slaveId, verified: true };
      }
      await this.assertUniqueBusAddress(deviceId, next);
      const row = await this.hwRepo.findOne({
        where: { code: deviceId, category: 'power-breaker', enabled: true },
      });
      if (!row) throw new Error(`断路器硬件 ${deviceId} 不存在、类型不符或已禁用`);
      const { modbus } = await this.ensureClient(deviceId);
      await modbus.writeSingleRegister(CTRL.SLAVE_ID, next.slaveId, current.slaveId, ctx?.signal);

      let verified = false;
      for (let attempt = 0; attempt < 4; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 300));
        try {
          await modbus.readHoldingRegisters(WORD.PF_FREQ, 2, next.slaveId, ctx?.signal);
          verified = true;
          break;
        } catch {
          // 地址切换后设备可能短暂重启，继续探测；写回显已证明设备接受了修改。
        }
      }

      const addressing = this.parseAddressing(deviceId, row.addressing);
      row.addressing = JSON.stringify({ ...addressing, slaveId: next.slaveId });
      try {
        await this.hwRepo.save(row);
      } catch (saveError) {
        try {
          await modbus.writeSingleRegister(
            CTRL.SLAVE_ID,
            current.slaveId,
            next.slaveId,
            ctx?.signal,
          );
        } catch (rollbackError) {
          throw new Error(
            `485 地址已改为 ${next.slaveId}，但台账保存和设备回退均失败: ${(saveError as Error).message}; ${(rollbackError as Error).message}`,
          );
        }
        throw new Error(
          `台账保存失败，设备地址已回退为 ${current.slaveId}: ${(saveError as Error).message}`,
        );
      }
      this.invalidateConfigCache(deviceId);
      return { oldSlaveId: current.slaveId, newSlaveId: next.slaveId, verified };
    });
  }

  // ============ 内部 ============

  private async writeOp(deviceId: string, op: number, signal?: AbortSignal): Promise<void> {
    const { modbus, slaveId } = await this.ensureClient(deviceId);
    const registryKey = this.registryKey(deviceId);
    try {
      await modbus.writeSingleRegister(CTRL.MOTOR_OP, op, slaveId, signal);
      this.registry?.markOnline(registryKey);
    } catch (err) {
      const dErr = classifyError('power', err);
      this.registry?.markFailure(registryKey, dErr.message, true);
      throw dErr;
    }
  }

  private async readWithFault(
    deviceId: string,
    modbus: ModbusRtuClient,
    slaveId: number,
    address: number,
    qty: number,
    signal?: AbortSignal,
  ): Promise<number[]> {
    const registryKey = this.registryKey(deviceId);
    try {
      const out = await modbus.readHoldingRegisters(address, qty, slaveId, signal);
      this.registry?.markOnline(registryKey);
      return out;
    } catch (err) {
      const dErr = classifyError('power', err);
      this.registry?.markFailure(registryKey, dErr.message, true);
      throw dErr;
    }
  }

  /** DB 按硬件编号精确取配置；只有没有 Repository 的独立运行场景才允许 env 兼容配置。 */
  private async ensureClient(deviceId: string): Promise<BreakerTransport & { slaveId: number }> {
    const config = await this.getConfig(deviceId);
    const endpoint = `tcp://${config.host}:${config.port}`;
    let transport = this.transports.get(endpoint);
    if (!transport) {
      const tcp = new TcpClient({
        host: config.host,
        port: config.port,
        timeoutMs: this.timeoutMs,
        deviceType: 'power',
        keepAlive: true,
        idleTimeoutMs: 30_000,
      });
      transport = {
        tcp,
        // slaveId 每次调用显式传入；默认值只用于兜底，不决定实际目标设备。
        modbus: new ModbusRtuClient(tcp, config.slaveId, this.frameIntervalMs),
      };
      this.transports.set(endpoint, transport);
    }
    this.registry?.register(this.registryKey(deviceId), endpoint);
    return { ...transport, slaveId: config.slaveId };
  }

  private async getConfig(deviceId: string): Promise<BreakerConnectionConfig> {
    if (!this.hwRepo) {
      return this.validateConfig(deviceId, {
        host: process.env.EPA_RTU_HOST ?? '192.168.50.21',
        port: Number.parseInt(process.env.EPA_RTU_PORT ?? '502', 10),
        slaveId: Number.parseInt(process.env.EPA_RTU_SLAVE_ID ?? '255', 10),
      });
    }

    const now = Date.now();
    const cached = this.dbCache.get(deviceId);
    if (cached && now - cached.at < this.DB_CACHE_TTL_MS) return cached.config;

    let row: HardwareUnit | null;
    try {
      row = await this.hwRepo.findOne({
        where: { code: deviceId, category: 'power-breaker', enabled: true },
      });
    } catch (err) {
      throw new Error(`读取断路器 ${deviceId} 配置失败: ${(err as Error).message}`);
    }
    if (!row) throw new Error(`断路器硬件 ${deviceId} 不存在、类型不符或已禁用`);

    const addressing = this.parseAddressing(deviceId, row.addressing);
    const config = this.validateConfig(deviceId, {
      host: row.ip ?? '',
      port: addressing.port ?? 502,
      slaveId: addressing.slaveId ?? 255,
    });
    await this.assertUniqueBusAddress(deviceId, config);
    this.dbCache.set(deviceId, { config, at: now });
    return config;
  }

  private parseAddressing(
    deviceId: string,
    raw: string | null,
  ): { port?: number; slaveId?: number } {
    if (!raw) return {};
    try {
      return JSON.parse(raw) as { port?: number; slaveId?: number };
    } catch {
      throw new Error(`断路器 ${deviceId} 的 addressing 不是有效 JSON`);
    }
  }

  private validateConfig(
    deviceId: string,
    config: BreakerConnectionConfig,
  ): BreakerConnectionConfig {
    if (!config.host.trim()) throw new Error(`断路器 ${deviceId} 未配置转换器 IP`);
    if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
      throw new Error(`断路器 ${deviceId} 的端口无效: ${config.port}`);
    }
    // 厂家设备出厂地址为 0xFF，因此这里允许 1..255，而不是常见的 1..247。
    if (!Number.isInteger(config.slaveId) || config.slaveId < 1 || config.slaveId > 255) {
      throw new Error(`断路器 ${deviceId} 的 slaveId 无效: ${config.slaveId}`);
    }
    return config;
  }

  /** 同一条 RTU-TCP/485 总线上地址重复会造成多台同时响应，必须在下发前拦截。 */
  private async assertUniqueBusAddress(
    deviceId: string,
    config: BreakerConnectionConfig,
  ): Promise<void> {
    if (!this.hwRepo) return;
    const rows = await this.hwRepo.find({
      where: { category: 'power-breaker', enabled: true },
    });
    for (const row of rows) {
      if (row.code === deviceId) continue;
      const addressing = this.parseAddressing(row.code, row.addressing);
      const host = row.ip?.trim() ?? '';
      const port = addressing.port ?? 502;
      const slaveId = addressing.slaveId ?? 255;
      if (host === config.host && port === config.port && slaveId === config.slaveId) {
        throw new Error(
          `断路器 ${deviceId} 与 ${row.code} 共用 ${host}:${port} 且 slaveId 都是 ${slaveId}`,
        );
      }
    }
  }

  private async enabledBreakerCodes(): Promise<string[]> {
    if (!this.hwRepo) return [GATEWAY_KEY];
    const rows = await this.hwRepo.find({
      where: { category: 'power-breaker', enabled: true },
      order: { id: 'ASC' },
    });
    if (rows.length === 0) throw new Error('没有已启用的智能断路器');
    return rows.map((row) => row.code);
  }

  private registryKey(deviceId: string): string {
    return `${GATEWAY_KEY}:${deviceId}`;
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
}
