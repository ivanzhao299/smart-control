import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { GinlongConfig, RootConfig } from '../../common/config/configuration';
import {
  GinlongClient,
  type GinlongStationRecord,
  type GinlongStationStatusVo,
} from './ginlong.client';

/** 单座电站归一化数据。 */
export interface PvStation {
  id: string;
  name: string;
  /** 装机容量 kWp */
  capacityKw: number;
  /** 当前实时功率 kW */
  currentPowerKw: number;
  /** 容量利用率 0~1 */
  utilization: number;
  /** 今日发电 kWh */
  todayKwh: number;
  /** 本月发电 kWh */
  monthKwh: number;
  /** 本年发电 kWh */
  yearKwh: number;
  /** 累计发电 kWh */
  totalKwh: number;
  /** 本月减碳 吨 CO₂ (锦浪直出) */
  monthCarbonT: number;
  inverterTotal: number;
  inverterOnline: number;
  online: boolean;
  weather: string;
  /** 锦浪侧数据时间 */
  dataTime: string | null;
}

export interface PvTotals {
  capacityKw: number;
  currentPowerKw: number;
  utilization: number;
  todayKwh: number;
  monthKwh: number;
  yearKwh: number;
  totalKwh: number;
  /** 本月减碳 吨 (锦浪直出, 真实值) */
  monthCarbonT: number;
  /** 累计减碳 吨 (按电网因子估算) */
  totalCarbonEstT: number;
  /** 等效植树 棵 (估算) */
  treesEquivalent: number;
  inverterTotal: number;
  inverterOnline: number;
}

export interface PvOverview {
  /** 后端是否配置了锦浪凭证 */
  enabled: boolean;
  /** 最近一次拉取是否成功 */
  ok: boolean;
  /** 正在等待首次拉取 */
  loading: boolean;
  /** 有缓存但当前展示的是过期数据 (最近一次拉取失败) */
  stale: boolean;
  /** 后端成功拉取时间 ISO */
  updatedAt: string | null;
  /** 锦浪数据时间 (取最新一座电站) */
  dataTime: string | null;
  weather: string;
  stationCount: number;
  normalCount: number;
  offlineCount: number;
  totals: PvTotals | null;
  stations: PvStation[];
  /** 最近一次错误信息 (拉取失败时) */
  error: string | null;
}

/** 华东电网平均 CO₂ 排放因子 kg/kWh (仅用于累计减碳/植树的趣味估算)。 */
const GRID_EMISSION_FACTOR_KG_PER_KWH = 0.7035;
/** 一棵树年均吸收 CO₂ 约 18.3 kg。 */
const TREE_ABSORB_KG_PER_YEAR = 18.3;

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const round1 = (n: number): number => Math.round(n * 10) / 10;
const round2 = (n: number): number => Math.round(n * 100) / 100;

function emptyOverview(enabled: boolean, loading: boolean): PvOverview {
  return {
    enabled,
    ok: false,
    loading: enabled && loading,
    stale: false,
    updatedAt: null,
    dataTime: null,
    weather: '',
    stationCount: 0,
    normalCount: 0,
    offlineCount: 0,
    totals: null,
    stations: [],
    error: null,
  };
}

/**
 * 把锦浪 userStationList 的原始记录归一为大屏视图模型。纯函数, 便于单测。
 * 电量优先取 *1 字段 (kWh), 缺失时回退 MWh 字段 ×1000。
 */
export function normalizePv(
  records: GinlongStationRecord[],
  statusVo: GinlongStationStatusVo,
  updatedAt: string,
): PvOverview {
  const stations: PvStation[] = records.map((r) => {
    const capacityKw = num(r.capacity) || num(r.capacity1);
    const currentPowerKw = num(r.power) || num(r.power1) / 1000;
    const cp = num(r.capacityPercent);
    const utilization =
      cp > 0 ? Math.min(cp, 1) : capacityKw > 0 ? currentPowerKw / capacityKw : 0;
    const inverterTotal = Math.round(num(r.inverterCount));
    const inverterOnline = Math.round(num(r.inverterOnlineCount));
    return {
      id: String(r.id ?? ''),
      name: String(r.stationName ?? ''),
      capacityKw: round2(capacityKw),
      currentPowerKw: round2(currentPowerKw),
      utilization: Math.max(0, Math.min(utilization, 1)),
      todayKwh: round1(num(r.dayEnergy1) || num(r.dayEnergy) * 1000),
      monthKwh: round1(num(r.monthEnergy1) || num(r.monthEnergy) * 1000),
      yearKwh: round1(num(r.yearEnergy1) || num(r.yearEnergy) * 1000),
      totalKwh: round1(num(r.allEnergy1) || num(r.allEnergy) * 1000),
      monthCarbonT: round2(num(r.monthCarbonDioxide)),
      inverterTotal,
      inverterOnline,
      online: inverterOnline > 0 || num(r.state) === 1,
      weather: String(r.condTxtD ?? '').trim(),
      dataTime: r.dataTimestampStr ? String(r.dataTimestampStr) : null,
    };
  });

  const sum = (pick: (s: PvStation) => number): number =>
    stations.reduce((acc, s) => acc + pick(s), 0);

  const capacityKw = round2(sum((s) => s.capacityKw));
  const currentPowerKw = round2(sum((s) => s.currentPowerKw));
  const totalKwh = round1(sum((s) => s.totalKwh));
  const totalCarbonEstT = round2((totalKwh * GRID_EMISSION_FACTOR_KG_PER_KWH) / 1000);

  const totals: PvTotals = {
    capacityKw,
    currentPowerKw,
    utilization: capacityKw > 0 ? Math.min(currentPowerKw / capacityKw, 1) : 0,
    todayKwh: round1(sum((s) => s.todayKwh)),
    monthKwh: round1(sum((s) => s.monthKwh)),
    yearKwh: round1(sum((s) => s.yearKwh)),
    totalKwh,
    monthCarbonT: round2(sum((s) => s.monthCarbonT)),
    totalCarbonEstT,
    treesEquivalent: Math.round((totalCarbonEstT * 1000) / TREE_ABSORB_KG_PER_YEAR),
    inverterTotal: sum((s) => s.inverterTotal),
    inverterOnline: sum((s) => s.inverterOnline),
  };

  // 数据时间取最新一座; 天气取第一个非空 (两站同址, 基本一致)。
  const dataTime =
    stations
      .map((s) => s.dataTime)
      .filter((v): v is string => Boolean(v))
      .sort()
      .pop() ?? null;
  const weather = stations.map((s) => s.weather).find(Boolean) ?? '';

  return {
    enabled: true,
    ok: true,
    loading: false,
    stale: false,
    updatedAt,
    dataTime,
    weather,
    stationCount: records.length,
    normalCount: Math.round(num(statusVo.normal)),
    offlineCount: Math.round(num(statusVo.offline)),
    totals,
    stations,
    error: null,
  };
}

@Injectable()
export class PvService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PvService.name);
  private readonly cfg: GinlongConfig;
  private client: GinlongClient | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private inflight = false;
  private cache: PvOverview | null = null;

  constructor(private readonly config: ConfigService<RootConfig>) {
    this.cfg = this.config.getOrThrow<GinlongConfig>('ginlong');
    if (this.cfg.enabled) {
      this.client = new GinlongClient({
        baseUrl: this.cfg.baseUrl,
        keyId: this.cfg.keyId,
        keySecret: this.cfg.keySecret,
        timeoutMs: this.cfg.timeoutMs,
      });
    }
  }

  onModuleInit(): void {
    if (!this.cfg.enabled || !this.client) {
      this.logger.log('锦浪光伏未配置 (缺 GINLONG_KEY_ID/SECRET) 或被显式停用, 光伏接口返回 disabled');
      return;
    }
    void this.refresh();
    this.timer = setInterval(() => void this.refresh(), this.cfg.refreshIntervalMs);
    // 不阻止进程退出。
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** 立即向锦浪拉取并刷新缓存; 失败时保留上一份数据并标记 stale。 */
  async refresh(): Promise<void> {
    if (!this.client || this.inflight) return;
    this.inflight = true;
    try {
      const { records, statusVo } = await this.client.fetchStationList();
      this.cache = normalizePv(records, statusVo, new Date().toISOString());
      this.logger.debug(
        `锦浪光伏刷新成功: ${this.cache.stationCount} 站, 当前 ${this.cache.totals?.currentPowerKw ?? 0} kW`,
      );
    } catch (error) {
      const message = (error as Error).message;
      this.logger.warn(`锦浪光伏拉取失败: ${message}`);
      if (this.cache) {
        // 保留上次数据, 仅标记过期, 大屏不闪断。
        this.cache = { ...this.cache, stale: true, error: message };
      } else {
        this.cache = { ...emptyOverview(true, false), ok: false, error: message };
      }
    } finally {
      this.inflight = false;
    }
  }

  getOverview(): PvOverview {
    if (!this.cfg.enabled) return emptyOverview(false, false);
    return this.cache ?? emptyOverview(true, true);
  }
}
