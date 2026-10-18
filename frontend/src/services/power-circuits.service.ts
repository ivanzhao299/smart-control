import { api } from './http';
import { queryOnce, invalidate } from './query.service';

export interface PowerReading {
  on: boolean;
  current: number;       // A
  voltage: number;       // V
  power: number;         // W
  powerFactor: number;
  energy: number;        // 累计 kWh
  lastReadAt: string;
}

export interface PowerCircuitView {
  id: number;
  code: string;
  name: string;
  floor: string;
  /** 所属电源域 code（hall 展厅 / park 园区 / 新楼栋）；后端按角色域过滤。 */
  domainCode: string;
  /** 所属电源域中文名（join power_domain 得到，可能为空，前端用域字典兜底）。 */
  domainName: string | null;
  category: string;
  gatewayCode: string | null;
  /** 所属网关/硬件中文名（后端 join hardware_units.name，电源页按设备分组做组标题）。 */
  gatewayName: string | null;
  relayChannel: number | null;
  meterAddress: number | null;
  ratedVoltage: number;
  ratedCurrent: number;
  ratedPower: number;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 是不是智能断路器回路 (LED 大屏总闸) — 前端据此显示空开专属详情 */
  isBreaker: boolean;
  reading: PowerReading;
  createdAt: string;
  updatedAt: string;
}

/** 智能断路器全量计量 (GET /power-circuits/:id/breaker) */
export interface BreakerMeasurements {
  voltages: [number, number, number];       // 三相电压 A/B/C
  currents: [number, number, number];       // 三相电流 A/B/C
  leakageCurrent: number;                    // 漏电 / 零序电流 A
  powers: [number, number, number, number];  // 功率 A/B/C/总 W
  energies: [number, number, number, number];// 电量 A/B/C/总 kWh
  temperatures: [number, number, number, number]; // 4 路接线柱温度 ℃
  powerFactor: number;
  frequency: number;                         // Hz
  mode: number;
  switchState: 'open' | 'closed' | 'locked' | 'unknown';
  alarms: {
    overVoltage: [boolean, boolean, boolean];
    underVoltage: [boolean, boolean, boolean];
    overCurrent: [boolean, boolean, boolean];
    leakage: boolean;
    overPower: [boolean, boolean, boolean, boolean];
    overHeat: [boolean, boolean, boolean, boolean];
    overEnergy: [boolean, boolean, boolean, boolean];
    any: boolean;
  };
}

export interface PowerCircuitUpsertDto {
  code: string;
  name: string;
  floor: string;
  /** 所属电源域 code；不传后端默认 hall。 */
  domainCode?: string;
  category?: string;
  gatewayCode?: string | null;
  relayChannel?: number | null;
  meterAddress?: number | null;
  ratedVoltage?: number;
  ratedCurrent?: number;
  ratedPower?: number;
  sortOrder?: number;
  icon?: string | null;
  description?: string | null;
  enabled?: boolean;
}

const PC = 'power-circuits:list';

export const powerCircuitsService = {
  // SWR 缓存; on/off 也 invalidate (它们改 reading.on, 列表"状态"列要刷新)
  list: (includeDisabled = false) =>
    queryOnce(`${PC}:${includeDisabled}`, () =>
      api.get<PowerCircuitView[]>('/power-circuits', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  detail: (id: number) => api.get<PowerCircuitView>(`/power-circuits/${id}`),
  create: (dto: PowerCircuitUpsertDto) =>
    api.post<PowerCircuitView>('/power-circuits', dto).then((r) => { invalidate(PC); return r; }),
  update: (id: number, dto: Partial<PowerCircuitUpsertDto>) =>
    api.put<PowerCircuitView>(`/power-circuits/${id}`, dto).then((r) => { invalidate(PC); return r; }),
  remove: (id: number) =>
    api.del<null>(`/power-circuits/${id}`).then((r) => { invalidate(PC); return r; }),
  on: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/on`).then((r) => { invalidate(PC); return r; }),
  off: (id: number) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/off`).then((r) => { invalidate(PC); return r; }),
  /** 空开专属: 三相分相 + 4 路温度 + 漏电 + 报警位 (只对 isBreaker 回路有意义) */
  breaker: (id: number) => api.get<BreakerMeasurements>(`/power-circuits/${id}/breaker`),
  /** 改名 (电源页行内编辑, 不需要 admin) */
  rename: (id: number, name: string) =>
    api.post<PowerCircuitView>(`/power-circuits/${id}/rename`, { name }).then((r) => { invalidate(PC); return r; }),
  /**
   * 单台时序器时序开机 (EPO b3 / SEQ55 0D) — 设备按各路延时依次上电。
   * 必须传 gatewayCode 指定哪一台, 两台各自独立、不允许一个按钮同时控两台。
   */
  seqAllOn: (gatewayCode: string) =>
    api
      .post<{ on: boolean }>('/power-circuits/sequencer/all-on', { gatewayCode })
      .then((r) => { invalidate(PC); return r; }),
  /** 单台时序器时序关机 — 先开的后关, 按延时依次断电。 */
  seqAllOff: (gatewayCode: string) =>
    api
      .post<{ on: boolean }>('/power-circuits/sequencer/all-off', { gatewayCode })
      .then((r) => { invalidate(PC); return r; }),
};

/** 电源域（Domain）—— 2026-10-17 第五轮：展厅/园区/新楼栋的可授权分组。 */
export interface PowerDomainView {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  description: string | null;
  enabled: boolean;
  /** 该域下回路数量（管理页展示）。 */
  circuitCount?: number;
  createdAt: string;
  updatedAt: string;
}

export interface PowerDomainInput {
  code?: string;
  name?: string;
  sortOrder?: number;
  description?: string | null;
  enabled?: boolean;
}

const PD = 'power-domains:list';

/** 电源域服务：读任何登录用户（后端按角色域过滤）；增删改仅 admin（zones）。 */
export const powerDomainsService = {
  list: (includeDisabled = false) =>
    queryOnce(`${PD}:${includeDisabled}`, () =>
      api.get<PowerDomainView[]>('/power-domains', {
        params: includeDisabled ? { includeDisabled: '1' } : {},
      })),
  create: (dto: PowerDomainInput) =>
    api.post<PowerDomainView>('/power-domains', dto).then((r) => { invalidate(PD); invalidate(PC); return r; }),
  update: (id: number, dto: Partial<PowerDomainInput>) =>
    api.put<PowerDomainView>(`/power-domains/${id}`, dto).then((r) => { invalidate(PD); invalidate(PC); return r; }),
  remove: (id: number) =>
    api.del<null>(`/power-domains/${id}`).then((r) => { invalidate(PD); invalidate(PC); return r; }),
};

/** 角色×电源域授权（第十六轮，后台可配三态）。 */
export interface PowerDomainGrantCell {
  role: string;
  domainCode: string;
  canRead: boolean;
  canWrite: boolean;
}
export interface PowerDomainGrantRole {
  role: string;
  label: string;
  builtin: boolean;
}
export interface PowerDomainGrantMatrix {
  domains: Array<{ code: string; name: string; enabled: boolean }>;
  roles: PowerDomainGrantRole[];
  lockedRoles: Array<{ role: string; label: string }>;
  grants: PowerDomainGrantCell[];
}

/** 角色×域授权矩阵：仅 admin(zones)；保存为全量事务替换。 */
export const powerDomainGrantService = {
  get: () => api.get<PowerDomainGrantMatrix>('/power-domain-grants'),
  save: (grants: PowerDomainGrantCell[]) =>
    api
      .put<PowerDomainGrantMatrix>('/power-domain-grants', { grants })
      .then((r) => { invalidate(PD); invalidate(PC); return r; }),
};

/** 电源回路自动开关 (定时 + 日落/日出) — 2026-10-01 新增 */
export interface PowerScheduleRule {
  id: number;
  circuitId: number;
  action: 'on' | 'off';
  mode: 'fixed' | 'sunset' | 'sunrise';
  time: string | null;
  offsetMin: number;
  weekdays: string | null;
  enabled: boolean;
  nextRunAt: string | null;
}

export interface PowerScheduleInput {
  circuitId: number;
  action: 'on' | 'off';
  mode: 'fixed' | 'sunset' | 'sunrise';
  time?: string | null;
  offsetMin?: number;
  weekdays?: string | null;
  enabled?: boolean;
}

/** 自动开关服务 (GET 公开; 写操作需 admin) */
export const powerSchedulesService = {
  list: () => api.get<PowerScheduleRule[]>('/power-schedules'),
  listForCircuit: (circuitId: number) => api.get<PowerScheduleRule[]>(`/power-schedules/circuit/${circuitId}`),
  /** 某回路下一次自动动作 (供 PWA 电源页展示) */
  nextRun: (circuitId: number) =>
    api.get<{ scheduleId: number; action: string; at: string } | null>(`/power-schedules/next/${circuitId}`),
  create: (dto: PowerScheduleInput) =>
    api.post<PowerScheduleRule>('/power-schedules', dto).then((r) => { invalidate(PC); return r; }),
  update: (id: number, dto: Partial<PowerScheduleInput>) =>
    api.put<PowerScheduleRule>(`/power-schedules/${id}`, dto).then((r) => { invalidate(PC); return r; }),
  remove: (id: number) =>
    api.del<null>(`/power-schedules/${id}`).then((r) => { invalidate(PC); return r; }),
};
