import { Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { ConfigService } from '@nestjs/config';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';

export interface PowerState {
  on: boolean;
}

/** Sprint G: 电源回路完整读数 (on/off + 电流/电压/功率/电量) */
export interface PowerReading {
  on: boolean;
  current: number;       // A
  voltage: number;       // V
  power: number;         // W
  powerFactor: number;   // 0-1
  energy: number;        // 累计 kWh
  lastReadAt: string;    // ISO timestamp
}

interface CircuitState {
  on: boolean;
  energy: number;      // kWh
  lastTickAt: number;  // ms timestamp
}

@Injectable()
export class PowerAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'power';
  }

  /** 老接口 (deviceId 字符串) — 给 scene-action / 早期 mock 保留. */
  private state = new Map<string, PowerState>();

  /** Sprint G 新接口 (circuit id number) — 给 PowerPage / PowerCircuitsService 用. */
  private circuitState = new Map<number, CircuitState>();

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
  ) {
    super(config, logger);
  }

  // ============ 老接口 (兼容) ============

  async turnOn(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'turnOn', ctx, async () => {
      const s: PowerState = { on: true };
      this.state.set(deviceId, s);
      return s;
    });
  }

  async turnOff(
    deviceId: string,
    _params: Record<string, unknown> = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'turnOff', ctx, async () => {
      const s: PowerState = { on: false };
      this.state.set(deviceId, s);
      return s;
    });
  }

  async getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<PowerState>> {
    return this.run(deviceId, 'getStatus', ctx, async () => {
      return this.state.get(deviceId) ?? { on: false };
    });
  }

  // ============ Sprint G 新接口 — 按 circuit id 操作 + 模拟读数 ============

  /** 通电 circuit (走继电器通道) */
  async circuitTurnOn(circuitId: number, ctx?: AdapterContext): Promise<AdapterResult<PowerReading>> {
    return this.run(`circuit-${circuitId}`, 'circuitTurnOn', ctx, async () => {
      const st = this.ensureCircuit(circuitId);
      st.on = true;
      st.lastTickAt = this.tsNow();
      return this.makeReading(circuitId, st, 220, 16, 0);
    });
  }

  /** 断电 circuit */
  async circuitTurnOff(circuitId: number, ctx?: AdapterContext): Promise<AdapterResult<PowerReading>> {
    return this.run(`circuit-${circuitId}`, 'circuitTurnOff', ctx, async () => {
      const st = this.ensureCircuit(circuitId);
      this.tickEnergy(st, 220, 16, 0);
      st.on = false;
      return this.makeReading(circuitId, st, 220, 16, 0);
    });
  }

  /**
   * 读 circuit 实时数据. 调用方传额定参数, mock adapter 用来估算实时值 (波动 ±15%).
   * 真 adapter (DTS634 等电能表) 接入后改读 modbus 寄存器, 忽略额定值.
   */
  async circuitReadStatus(
    circuitId: number,
    rated: { voltage: number; current: number; power: number },
    ctx?: AdapterContext,
  ): Promise<AdapterResult<PowerReading>> {
    return this.run(`circuit-${circuitId}`, 'circuitReadStatus', ctx, async () => {
      const st = this.ensureCircuit(circuitId);
      this.tickEnergy(st, rated.voltage, rated.current, rated.power);
      return this.makeReading(circuitId, st, rated.voltage, rated.current, rated.power);
    });
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.run('power-mock', 'healthCheck', ctx, async () => ({ ok: true as const }));
  }

  // ============ 内部 ============

  /** Wall-clock 毫秒. backend 跑 node, Date.now() 完全可用. */
  private tsNow(): number {
    return Date.now();
  }

  private ensureCircuit(id: number): CircuitState {
    let st = this.circuitState.get(id);
    if (!st) {
      const now = this.tsNow();
      st = { on: false, energy: 0, lastTickAt: now };
      this.circuitState.set(id, st);
    }
    return st;
  }

  /** 累加从上次 tick 到现在的能耗 (kWh). 断电期间不算. */
  private tickEnergy(st: CircuitState, ratedV: number, ratedI: number, ratedP: number): void {
    if (!st.on) {
      st.lastTickAt = this.tsNow();
      return;
    }
    const now = this.tsNow();
    const elapsedH = (now - st.lastTickAt) / 3_600_000;
    const power = this.estimatePower(ratedV, ratedI, ratedP, st);
    st.energy += (power / 1000) * elapsedH;
    st.lastTickAt = now;
  }

  private makeReading(
    id: number,
    st: CircuitState,
    ratedV: number,
    ratedI: number,
    ratedP: number,
  ): PowerReading {
    const now = this.tsNow();
    if (!st.on) {
      return {
        on: false,
        current: 0,
        voltage: 0,
        power: 0,
        powerFactor: 0,
        energy: round(st.energy, 3),
        lastReadAt: new Date(now).toISOString(),
      };
    }
    const voltage = ratedV + this.noise(id, 1) * 5 - 2.5;
    const power = this.estimatePower(ratedV, ratedI, ratedP, st);
    const current = voltage > 0 ? power / voltage : 0;
    const powerFactor = 0.88 + this.noise(id, 2) * 0.1;
    return {
      on: true,
      current: round(current, 2),
      voltage: round(voltage, 1),
      power: round(power, 1),
      powerFactor: round(powerFactor, 2),
      energy: round(st.energy, 3),
      lastReadAt: new Date(now).toISOString(),
    };
  }

  private estimatePower(ratedV: number, ratedI: number, ratedP: number, st: CircuitState): number {
    const base = ratedP > 0 ? ratedP * 0.75 : ratedV * ratedI * 0.7;
    const fluctuation = (this.noise(st.lastTickAt, 7) - 0.5) * 0.3;
    return Math.max(0, base * (1 + fluctuation));
  }

  /** 确定性伪随机 0-1, 同种子同输出 */
  private noise(seed: number, salt: number): number {
    const x = Math.sin(seed * 9301 + salt * 49297) * 233280;
    return x - Math.floor(x);
  }
}

function round(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}
