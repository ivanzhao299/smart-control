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
import { ModbusTcpClient } from '../transports/modbus-tcp';
import type { FanSpeed, HvacMode, HvacState } from './mock-hvac.adapter';
import {
  CTRL_OFFSET,
  ctrlBaseAddr,
  decodeIndoorState,
  FAN_TO_REG,
  IndoorAddress,
  MODE_TO_REG,
  parseIndoorAddress,
  stateBaseAddr,
  STATE_REGS_PER_INDOOR,
  tempToReg,
} from './zhonghong-mbt-protocol';

/**
 * HVAC 适配器 - 中弘 B 集控网关 (TCP 款)
 *
 * 协议: Modbus TCP, 默认 502 端口.
 * 部署: 2 台网关, 一台/外机, 直接接交换机 (无需 USR-TCP232).
 *
 * device.address (JSON) 决定路由到哪个网关 + 内机号:
 *   {"gwHost":"192.168.50.51","n":0}   // 1F 网关第 0 台内机
 *   {"gwHost":"192.168.50.52","n":5}   // 2F 网关第 5 台内机
 *
 * 现场可通过修改设备表 address 字段重新分组, 无需改代码.
 */
@Injectable()
export class ModbusHvacAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'hvac';
  }

  /** 每个网关 IP 对应一个 Modbus TCP 客户端 (惰性创建) */
  private readonly clients = new Map<string, { modbus: ModbusTcpClient; key: string }>();
  private readonly timeoutMs: number;
  private readonly retries: number;

  /** DB 配置缓存 — 所有 hvac-gateway category 的 hardware_unit 的 ip 列表, 用于 ping 默认网关 */
  private dbCache: { gateways: Array<{ code: string; ip: string; port: number }>; at: number } = {
    gateways: [],
    at: 0,
  };
  private readonly DB_CACHE_TTL_MS = 5000;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
    @Optional() @InjectRepository(HardwareUnit) private readonly hwRepo?: Repository<HardwareUnit>,
  ) {
    super(config, logger);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
  }

  /** 查 DB 里所有 hvac-gateway category 记录, 拿到当前实际 IP/Port. 5s TTL. */
  private async getGatewaysFromDb(): Promise<Array<{ code: string; ip: string; port: number }>> {
    if (!this.hwRepo) return [];
    const now = Date.now();
    if (now - this.dbCache.at < this.DB_CACHE_TTL_MS) {
      return this.dbCache.gateways;
    }
    try {
      const rows = await this.hwRepo.find({ where: { category: 'hvac-gateway' } });
      const gateways = rows
        .filter((r) => !!r.ip)
        .map((r) => {
          let port = 502;
          if (r.addressing) {
            try {
              const parsed = JSON.parse(r.addressing) as { port?: number };
              if (typeof parsed.port === 'number') port = parsed.port;
            } catch { /* 忽略非 JSON */ }
          }
          return { code: r.code, ip: r.ip as string, port };
        });
      this.dbCache = { gateways, at: now };
      return gateways;
    } catch (err) {
      this.logger.warn(`getGatewaysFromDb 失败: ${(err as Error).message}`, { context: 'ModbusHvacAdapter' });
      this.dbCache = { gateways: [], at: now };
      return [];
    }
  }

  /** PUT /api/hardware/:id 成功后调, 让 ping 用最新 DB 配置, 同时清掉所有 TCP 客户端缓存. */
  invalidateConfigCache(): void {
    this.dbCache = { gateways: [], at: 0 };
    // 清掉所有 TCP 客户端, 让下次调用按最新 IP 重建.
    // 注意: device 表里的 gwHost 字段也需要后台同步改, 否则即使重建了 TCP 也是连旧 IP.
    // P3 会通过 hardware_unit.code 替换 IP 直挂的耦合.
    this.clients.clear();
  }

  /** P2 — 给 DriverRegistryService 注册用 */
  static describe(): import('../driver-descriptor').DriverDescriptor {
    return {
      kind: 'zhonghong-mbt',
      displayName: '中弘 ZHONGHONG B 集控网关 (TCP / VRF 空调)',
      vendor: '中弘 ZHONGHONG',
      category: 'hvac-gateway',
      protocol: 'modbus-tcp',
      capabilities: [
        'turn_on', 'turn_off', 'set_temperature', 'set_mode', 'set_fan_speed', 'get_status', 'health_check',
      ],
      defaultAddressing: { slaveId: 1, port: 502, maxIndoor: 64, protocol: 'MODBUS-TCP (MBT v3.2)' },
      paramSchema: {
        ip:        { type: 'string', label: '网关 IP', required: true, placeholder: '192.168.x.x' },
        port:      { type: 'number', label: 'TCP 端口', default: 502, min: 1, max: 65535 },
        slaveId:   { type: 'number', label: 'Modbus 从机号', default: 1, min: 1, max: 247 },
        maxIndoor: { type: 'number', label: '最大内机数', default: 64, min: 1, max: 64 },
      },
      remark: '一台网关挂 1-64 台 VRF 内机, 走 Modbus TCP. 跟商用奥克斯/大金/美的等品牌 VRF 主机配对.',
    };
  }

  /** 拿到 deviceId 对应内机的网关客户端 + 网关 key */
  private resolve(deviceId: string): { addr: IndoorAddress; modbus: ModbusTcpClient; key: string } {
    const addr = parseIndoorAddress(deviceId);
    if (!addr) {
      throw new DeviceProtocolError('hvac', `invalid deviceId, expect JSON {gwHost,n}: ${deviceId}`);
    }
    const key = `hvac-zh-${addr.gwHost}:${addr.gwPort ?? 502}`;
    let entry = this.clients.get(key);
    if (!entry) {
      const tcp = new TcpClient({
        host: addr.gwHost,
        port: addr.gwPort ?? 502,
        deviceType: 'hvac',
        timeoutMs: this.timeoutMs,
      });
      const modbus = new ModbusTcpClient(tcp, addr.slaveId ?? 1);
      this.clients.set(key, { modbus, key });
      if (!this.isMock()) this.registry.register(key, `modbus-tcp://${addr.gwHost}:${addr.gwPort ?? 502}`);
      entry = { modbus, key };
    }
    return { addr, modbus: entry.modbus, key: entry.key };
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    // DB > env > default 三级取默认网关地址
    const dbGateways = await this.getGatewaysFromDb();
    const dbFirst = dbGateways[0];
    const host = dbFirst?.ip ?? process.env.HVAC_HOST ?? '192.168.50.51';
    const port = dbFirst?.port ?? Number.parseInt(process.env.HVAC_PORT ?? '502', 10);
    const slaveId = Number.parseInt(process.env.HVAC_DEFAULT_SLAVE_ID ?? '1', 10);
    const key = `hvac-zh-${host}:${port}`;
    let entry = this.clients.get(key);
    if (!entry) {
      const tcp = new TcpClient({ host, port, deviceType: 'hvac', timeoutMs: this.timeoutMs });
      const modbus = new ModbusTcpClient(tcp, slaveId);
      this.clients.set(key, { modbus, key });
      if (!this.isMock()) this.registry.register(key, `modbus-tcp://${host}:${port}`);
      entry = { modbus, key };
    }
    try {
      // 读性能寄存器 2000 验证连接
      await entry.modbus.readHoldingRegisters(2000, 1, slaveId, ctx?.signal);
      this.registry.markOnline(key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(key, dErr.message, false);
      throw dErr;
    }
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('hvac-gateway', 'healthCheck', ctx, async () => {
      await this.ping(ctx);
      return { ok: true as const };
    });
  }

  async turnOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const r = this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.POWER, 1, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const r = this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.POWER, 0, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setTemperature(deviceId: string, params: { value?: number; temperature?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setTemperature', ctx, async () => {
      const v = Number(params.value ?? params.temperature);
      if (!Number.isFinite(v) || v < 16 || v > 32) {
        throw new DeviceProtocolError('hvac', `temperature out of range 16-32: ${v}`);
      }
      const r = this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.TEMP, tempToReg(v), ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setMode(deviceId: string, params: { mode?: HvacMode } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setMode', ctx, async () => {
      const mode = params.mode ?? 'auto';
      const regVal = MODE_TO_REG[mode];
      if (regVal === undefined) {
        throw new DeviceProtocolError('hvac', `invalid hvac mode: ${mode}`);
      }
      const r = this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.MODE, regVal, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async setFanSpeed(deviceId: string, params: { speed?: FanSpeed } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setFanSpeed', ctx, async () => {
      const speed = params.speed ?? 'auto';
      const regVal = FAN_TO_REG[speed];
      if (regVal === undefined) {
        throw new DeviceProtocolError('hvac', `invalid fan speed: ${speed}`);
      }
      const r = this.resolve(deviceId);
      await this.writeReg(r, ctrlBaseAddr(r.addr.n) + CTRL_OFFSET.FAN, regVal, ctx?.signal);
      return this.readState(r, ctx?.signal);
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      const r = this.resolve(deviceId);
      return this.readState(r, ctx?.signal);
    });
  }

  // ============ 内部 ============

  private async writeReg(
    r: { addr: IndoorAddress; modbus: ModbusTcpClient; key: string },
    address: number,
    value: number,
    signal?: AbortSignal,
  ): Promise<void> {
    try {
      await withRetry(
        () => r.modbus.writeSingleRegister(address, value, r.addr.slaveId ?? 1, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(r.key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(r.key, dErr.message, true);
      throw dErr;
    }
  }

  private async readState(
    r: { addr: IndoorAddress; modbus: ModbusTcpClient; key: string },
    signal?: AbortSignal,
  ): Promise<HvacState> {
    const base = stateBaseAddr(r.addr.n);
    let regs: number[];
    try {
      regs = await withRetry(
        () => r.modbus.readHoldingRegisters(base, STATE_REGS_PER_INDOOR, r.addr.slaveId ?? 1, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(r.key);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(r.key, dErr.message, true);
      throw dErr;
    }
    const state = decodeIndoorState(regs);
    return {
      on: state.on,
      mode: state.mode as HvacMode,
      temperature: state.temperature,
      fan: state.fan as FanSpeed,
      roomTemp: state.roomTemp,
    };
  }
}
