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
import {
  AUX_FAN_MAP,
  AUX_MODE_MAP,
  fanFromRaw,
  HVAC_REG,
  INDOOR_BLOCK_SIZE,
  indoorBaseAddr,
  modeFromRaw,
} from './aux-ccm270b-registers';

const GATEWAY_KEY = 'hvac-modbus';

/**
 * 真实 HVAC 适配器 - 奥克斯商用 VRF (ARV-X 系列) + CCM-270B 网关
 *
 * Modbus TCP, 默认端口 502.
 * 单 slave_id (网关本身, 默认 1), 内机通过寄存器偏移寻址:
 *   设备 address 字段 (JSON): {"indoorIdx": 1..10}  ← 推荐方式
 *   或 (向后兼容):              {"slaveId": N}      ← 老格式: 视为 indoorIdx=1, slaveId=N
 *
 * 每台内机占用一块 16-寄存器 区域, 偏移见 HVAC_REG.
 * 寄存器细节见 aux-ccm270b-registers.ts.
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
      await this.modbus.readHoldingRegisters(HVAC_REG.POWER, 1, this.defaultUnit, ctx?.signal);
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
      const tgt = this.targetFor(deviceId);
      await this.writeReg(tgt.base + HVAC_REG.POWER, 1, tgt.unit, ctx?.signal);
      return this.readState(tgt, ctx?.signal);
    });
  }

  async turnOff(deviceId: string, _p: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const tgt = this.targetFor(deviceId);
      await this.writeReg(tgt.base + HVAC_REG.POWER, 0, tgt.unit, ctx?.signal);
      return this.readState(tgt, ctx?.signal);
    });
  }

  async setTemperature(deviceId: string, params: { value?: number; temperature?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setTemperature', ctx, async () => {
      const v = Number(params.value ?? params.temperature);
      if (!Number.isFinite(v) || v < 16 || v > 30) {
        throw new DeviceProtocolError('hvac', `temperature out of range: ${v}`);
      }
      const tgt = this.targetFor(deviceId);
      await this.writeReg(tgt.base + HVAC_REG.SET_TEMP, Math.round(v * 10), tgt.unit, ctx?.signal);
      return this.readState(tgt, ctx?.signal);
    });
  }

  async setMode(deviceId: string, params: { mode?: HvacMode } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setMode', ctx, async () => {
      const mode = params.mode ?? 'auto';
      if (!(mode in AUX_MODE_MAP)) {
        throw new DeviceProtocolError('hvac', `invalid hvac mode: ${mode}`);
      }
      const tgt = this.targetFor(deviceId);
      await this.writeReg(tgt.base + HVAC_REG.MODE, AUX_MODE_MAP[mode], tgt.unit, ctx?.signal);
      return this.readState(tgt, ctx?.signal);
    });
  }

  async setFanSpeed(deviceId: string, params: { speed?: FanSpeed } = {}, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'setFanSpeed', ctx, async () => {
      const speed = params.speed ?? 'auto';
      if (!(speed in AUX_FAN_MAP)) {
        throw new DeviceProtocolError('hvac', `invalid fan speed: ${speed}`);
      }
      const tgt = this.targetFor(deviceId);
      await this.writeReg(tgt.base + HVAC_REG.FAN, AUX_FAN_MAP[speed], tgt.unit, ctx?.signal);
      return this.readState(tgt, ctx?.signal);
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<HvacState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      return this.readState(this.targetFor(deviceId), ctx?.signal);
    });
  }

  /**
   * 从 deviceId 解析出实际访问目标:
   *   "1".."64"         → indoorIdx=N, slaveId=default, base = (N-1) × 16  ← REST API 主推
   *   {"indoorIdx": N}  → 同上 (JSON 形式, 给 device.address 字段用)
   *   {"slaveId":  N}   → 兼容老格式, base=0, slaveId=N
   *   非数字 / 非 JSON  → slaveId=default, base=0 (默认指向 1 号内机)
   */
  private targetFor(deviceId: string): { unit: number; base: number } {
    const asNum = Number.parseInt(deviceId, 10);
    if (Number.isFinite(asNum) && String(asNum) === deviceId && asNum >= 1 && asNum <= 64) {
      return { unit: this.defaultUnit, base: indoorBaseAddr(asNum) };
    }
    try {
      const j = JSON.parse(deviceId) as { indoorIdx?: number; slaveId?: number };
      if (typeof j.indoorIdx === 'number') {
        return {
          unit: typeof j.slaveId === 'number' ? j.slaveId : this.defaultUnit,
          base: indoorBaseAddr(j.indoorIdx),
        };
      }
      if (typeof j.slaveId === 'number') {
        return { unit: j.slaveId, base: 0 };
      }
    } catch {
      // not JSON
    }
    return { unit: this.defaultUnit, base: 0 };
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

  private async readState(tgt: { unit: number; base: number }, signal?: AbortSignal): Promise<HvacState> {
    let regs: number[];
    try {
      regs = await withRetry(
        () => this.modbus.readHoldingRegisters(tgt.base + HVAC_REG.POWER, INDOOR_BLOCK_SIZE, tgt.unit, signal),
        { retries: this.retries, timeoutMs: this.timeoutMs, signal },
      );
      this.registry.markOnline(GATEWAY_KEY);
    } catch (err) {
      const dErr = classifyError('hvac', err);
      this.registry.markFailure(GATEWAY_KEY, dErr.message, true);
      throw dErr;
    }

    const roomTempRaw = regs[HVAC_REG.ROOM_TEMP];
    const roomTemp = roomTempRaw && roomTempRaw !== 0xffff ? roomTempRaw / 10 : undefined;

    return {
      on: regs[HVAC_REG.POWER] === 1,
      mode: modeFromRaw(regs[HVAC_REG.MODE]) as HvacMode,
      temperature: regs[HVAC_REG.SET_TEMP] / 10,
      fan: fanFromRaw(regs[HVAC_REG.FAN]) as FanSpeed,
      roomTemp,
    };
  }
}
