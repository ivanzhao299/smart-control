import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { AdapterConnectionRegistry } from '../connection-registry';
import { classifyError, DeviceProtocolError } from '../errors';
import { withRetry } from '../retry';
import { TcpClient } from '../transports/tcp-client';
import { ModbusTcpClient } from '../transports/modbus-tcp';
import type { FanSpeed, HvacMode, HvacState } from './mock-hvac.adapter';

const GATEWAY_KEY = 'hvac-modbus';

const REG_POWER = 0x00; // 0/1
const REG_MODE = 0x01; // 0..4
const REG_SET_TEMP = 0x02; // x10
const REG_FAN = 0x03; // 0..3
const REG_ROOM_TEMP = 0x10; // x10 (read-only)

const MODE_MAP: Record<HvacMode, number> = { cool: 0, heat: 1, fan: 2, auto: 3, dry: 4 };
const MODE_REVERSE: HvacMode[] = ['cool', 'heat', 'fan', 'auto', 'dry'];

const FAN_MAP: Record<FanSpeed, number> = { auto: 0, low: 1, mid: 2, high: 3 };
const FAN_REVERSE: FanSpeed[] = ['auto', 'low', 'mid', 'high'];

/**
 * 真实 HVAC 适配器 - 奥克斯中央空调 + Modbus/BACnet 网关。
 *
 * 使用 Modbus TCP (默认 502 端口)。
 * 设备 address 字段可编码 slaveId, 例如 {"slaveId":2}；缺省使用 HVAC_DEFAULT_SLAVE_ID。
 *
 * 寄存器映射 (Holding Registers):
 *   0x00 power     0=off 1=on
 *   0x01 mode      0=cool 1=heat 2=fan 3=auto 4=dry
 *   0x02 set temp  ×10 (例: 250 = 25.0°C)
 *   0x03 fan       0=auto 1=low 2=mid 3=high
 *   0x10 room temp ×10  (read-only)
 */
@Injectable()
export class ModbusHvacAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'hvac';
  }

  private readonly modbus: ModbusTcpClient;
  private readonly endpoint: string;
  private readonly defaultUnit: number;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly registry: AdapterConnectionRegistry,
  ) {
    super(config, logger);
    const host = process.env.HVAC_HOST ?? '192.168.50.50';
    const port = Number.parseInt(process.env.HVAC_PORT ?? '502', 10);
    this.defaultUnit = Number.parseInt(process.env.HVAC_DEFAULT_SLAVE_ID ?? '1', 10);
    this.timeoutMs = Number.parseInt(process.env.DEVICE_TIMEOUT_MS ?? '3000', 10);
    this.retries = Number.parseInt(process.env.DEVICE_RETRIES ?? '3', 10);
    this.endpoint = `modbus-tcp://${host}:${port}`;
    const tcp = new TcpClient({
      host,
      port,
      deviceType: 'hvac',
      timeoutMs: this.timeoutMs,
    });
    this.modbus = new ModbusTcpClient(tcp, this.defaultUnit);
    if (!this.isMock()) this.registry.register(GATEWAY_KEY, this.endpoint);
  }

  async ping(ctx?: AdapterContext): Promise<void> {
    try {
      await this.modbus.readHoldingRegisters(REG_POWER, 1, this.defaultUnit, ctx?.signal);
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('hvac', err);
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

  async turnOn(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const unit = this.unitFor(deviceId);
      await this.writeReg(REG_POWER, 1, unit, ctx?.signal);
      return this.readState(unit, ctx?.signal);
    });
  }

  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const unit = this.unitFor(deviceId);
      await this.writeReg(REG_POWER, 0, unit, ctx?.signal);
      return this.readState(unit, ctx?.signal);
    });
  }

  async setTemperature(deviceId: string, params: { value?: number; temperature?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setTemperature', ctx, async () => {
      const v = Number(params.value ?? params.temperature);
      if (!Number.isFinite(v) || v < 16 || v > 30) {
        throw new DeviceProtocolError('hvac', `temperature out of range: ${v}`);
      }
      const unit = this.unitFor(deviceId);
      await this.writeReg(REG_SET_TEMP, Math.round(v * 10), unit, ctx?.signal);
      return this.readState(unit, ctx?.signal);
    });
  }

  async setMode(deviceId: string, params: { mode?: HvacMode } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setMode', ctx, async () => {
      const mode = params.mode ?? 'auto';
      if (!(mode in MODE_MAP)) {
        throw new DeviceProtocolError('hvac', `invalid hvac mode: ${mode}`);
      }
      const unit = this.unitFor(deviceId);
      await this.writeReg(REG_MODE, MODE_MAP[mode], unit, ctx?.signal);
      return this.readState(unit, ctx?.signal);
    });
  }

  async setFanSpeed(deviceId: string, params: { speed?: FanSpeed } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setFanSpeed', ctx, async () => {
      const speed = params.speed ?? 'auto';
      if (!(speed in FAN_MAP)) {
        throw new DeviceProtocolError('hvac', `invalid fan speed: ${speed}`);
      }
      const unit = this.unitFor(deviceId);
      await this.writeReg(REG_FAN, FAN_MAP[speed], unit, ctx?.signal);
      return this.readState(unit, ctx?.signal);
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      const unit = this.unitFor(deviceId);
      return this.readState(unit, ctx?.signal);
    });
  }

  private unitFor(deviceId: string): number {
    try {
      const j = JSON.parse(deviceId) as { slaveId?: number };
      if (typeof j.slaveId === 'number') return j.slaveId;
    } catch {
      // not JSON, fallthrough
    }
    return this.defaultUnit;
  }

  private async writeReg(addr: number, value: number, unit: number, signal?: AbortSignal): Promise<void> {
    try {
      await withRetry(
        () => this.modbus.writeSingleRegister(addr, value, unit, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }
  }

  private async readState(unit: number, signal?: AbortSignal): Promise<HvacState> {
    let regs: number[];
    try {
      regs = await withRetry(
        () => this.modbus.readHoldingRegisters(REG_POWER, 4, unit, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }

    let roomTemp: number | undefined;
    try {
      const t = await this.modbus.readHoldingRegisters(REG_ROOM_TEMP, 1, unit, signal);
      roomTemp = t[0] / 10;
    } catch {
      // room temp 可选, 失败忽略
    }

    return {
      on: regs[0] === 1,
      mode: MODE_REVERSE[regs[1]] ?? 'auto',
      temperature: regs[2] / 10,
      fan: FAN_REVERSE[regs[3]] ?? 'auto',
      roomTemp,
    };
  }
}
