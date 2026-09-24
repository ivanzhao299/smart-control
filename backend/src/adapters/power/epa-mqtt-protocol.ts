import { randomUUID } from 'crypto';
import {
  decodeElectricStatus,
  type BreakerMeasurements,
  type SwitchState,
} from './epa-breaker-registers';

export interface EpaMqttChild {
  ClientID?: string;
  Voltage?: number | number[];
  Current?: number | number[];
  Power?: number | number[];
  Energy?: number | number[];
  Temperature?: number | number[];
  ElectricStatus?: number;
  SwitchStatus?: number;
  Mode?: number;
  UsartComm?: number;
  MoterOperation?: number;
}

export interface EpaMqttMessage {
  SysTime?: string;
  bid?: number;
  mid?: string;
  result?: boolean;
  message?: number;
  Children?: EpaMqttChild[];
}

export function newMessageId(): string {
  return randomUUID().toUpperCase();
}

export function controlMessage(
  clientId: string,
  operation: 1 | 2 | 3 | 4,
  mid = newMessageId(),
): EpaMqttMessage {
  return {
    bid: 202,
    mid,
    Children: [{ ClientID: clientId, MoterOperation: operation }],
  };
}

export function readOneMessage(clientId: string, mid = newMessageId()): EpaMqttMessage {
  return { bid: 208, mid, Children: [{ ClientID: clientId }] };
}

export function parseMessage(payload: Buffer | string): EpaMqttMessage {
  const text = Buffer.isBuffer(payload) ? payload.toString('utf8') : payload;
  const parsed = JSON.parse(text) as EpaMqttMessage;
  if (!parsed || typeof parsed !== 'object') throw new Error('MQTT payload 必须是 JSON 对象');
  return parsed;
}

function tuple(
  values: number | number[] | undefined,
  length: 3 | 4,
  scalarTotal = false,
): number[] {
  const input = Array.isArray(values) ? values : values == null ? [] : [values];
  const output = Array.from({ length }, (_, index) => {
    const n = Number(input[index] ?? 0);
    return Number.isFinite(n) ? n : 0;
  });
  // 单相 4G 型号可能只上传一个总功率/总电量标量；系统统一把第 4 项作为总量。
  if (scalarTotal && !Array.isArray(values) && values != null) output[3] = output[0];
  return output;
}

export function switchState(value: number | undefined): SwitchState {
  if (value === 0) return 'open';
  if (value === 1) return 'closed';
  if (value === 2) return 'locked';
  return 'unknown';
}

/** 厂家 MQTT 上传仍是传输原值；这里按协议统一换算成系统使用的物理单位。 */
export function childToMeasurements(child: EpaMqttChild): BreakerMeasurements {
  const voltageRaw = tuple(child.Voltage, 3);
  const currentRaw = tuple(child.Current, 4);
  const powerRaw = tuple(child.Power, 4, true);
  const energyRaw = tuple(child.Energy, 4, true);
  const temperatureRaw = tuple(child.Temperature, 4);
  return {
    voltages: voltageRaw.map((value) => value / 1000) as [number, number, number],
    currents: currentRaw.slice(0, 3).map((value) => value / 1000) as [number, number, number],
    leakageCurrent: currentRaw[3] / 1000,
    powers: powerRaw as [number, number, number, number],
    energies: energyRaw.map((value) => value / 1000) as [number, number, number, number],
    temperatures: temperatureRaw.map((value) => value / 100) as [number, number, number, number],
    powerFactor: 0,
    frequency: 0,
    mode: Number(child.Mode ?? 0),
    switchState: switchState(child.SwitchStatus),
    alarms: decodeElectricStatus(Number(child.ElectricStatus ?? 0)),
  };
}
