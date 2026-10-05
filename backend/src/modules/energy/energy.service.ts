import {
  ConflictException,
  Inject,
  Injectable,
  Logger as NesLogger,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { EnergyDaily } from '../../entities/energy-daily.entity';
import { HperforApiAdapter } from '../../adapters/power/hperfor-api.adapter';
import { ControlBus, ControlEvent } from '../../services/control-bus';
import { PvService } from '../pv/pv.service';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { buildParkEnergyModel, type EnergyAssets } from './park-energy-model';
import {
  ENERGY_ASSETS_KEY,
  ENERGY_ASSETS_SCHEMA_VERSION,
  defaultEnergyAssets,
  normalizeEnergyAssets,
} from './energy-assets';

// ============ 日期工具（按服务器本地时区，生产为 Asia/Shanghai） ============
const pad = (n: number): string => String(n).padStart(2, '0');
const fmtDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayStr = (): string => fmtDate(new Date());
const daysAgoStr = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return fmtDate(d);
};
const monthStartStr = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-01`;
};

export interface EnergyOverview {
  totalKwh: number;
  todayKwh: number;
  monthKwh: number;
  yesterdayKwh: number;
  circuitCount: number;
  pricePerKwh: number;
  todayCost: number;
  totalCost: number;
  peakPowerW: number;
}

@Injectable()
export class EnergyService implements OnModuleInit, OnModuleDestroy {
  private readonly nesLogger = new NesLogger(EnergyService.name);
  private syncTimer?: NodeJS.Timeout;
  private unsubscribe?: () => void;
  /** 云电表回路 code 集合（这些回路以平台数据为准，不做积分） */
  private cloudCodes = new Set<string>();
  /** 积分：回路 code → 上次读数 {at(ms), power(W)} */
  private lastSample = new Map<string, { at: number; power: number }>();
  private readonly pricePerKwh = Number(process.env.ENERGY_PRICE_KWH ?? 0.65);

  constructor(
    @InjectRepository(PowerCircuit) private readonly circuitRepo: Repository<PowerCircuit>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    @InjectRepository(EnergyDaily) private readonly dailyRepo: Repository<EnergyDaily>,
    private readonly pv: PvService,
    private readonly runtimeConfig: RuntimeConfigStore,
    @Optional() private readonly webBreaker?: HperforApiAdapter,
    @Optional() private readonly bus?: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger?: Logger,
  ) {}

  // ============ 生命周期 ============

  onModuleInit(): void {
    // 订阅实时读数 → 功率积分兜底
    if (this.bus) {
      this.unsubscribe = this.bus.subscribe((e) => this.handleEvent(e));
    }
    // 每小时同步一次云电量（补全最近 3 天，含今日）
    const timer = setInterval(() => {
      void this.syncCloud(2);
    }, 3600_000);
    timer.unref?.();
    this.syncTimer = timer;
    // 启动：先加载云回路集合，再同步最近 30 天
    void this.bootstrap();
  }

  onModuleDestroy(): void {
    if (this.syncTimer) clearInterval(this.syncTimer);
    this.unsubscribe?.();
  }

  private async bootstrap(): Promise<void> {
    try {
      // 幂等写入默认台账种子（revision 1），已存在则不覆盖。
      await this.runtimeConfig.initialize({
        key: ENERGY_ASSETS_KEY,
        schemaVersion: ENERGY_ASSETS_SCHEMA_VERSION,
        value: defaultEnergyAssets(),
        normalize: normalizeEnergyAssets,
        actor: 'system',
        source: 'energy-bootstrap',
      });
      await this.loadCloudCodes();
      await this.syncCloud(30);
    } catch (err) {
      this.nesLogger.warn(`能源启动同步异常: ${(err as Error).message}`);
    }
  }

  /** 加载云电表回路 code（gateway 为 power-breaker-web 的回路） */
  private async loadCloudCodes(): Promise<void> {
    this.cloudCodes.clear();
    const circuits = await this.circuitRepo.find({ where: { enabled: true } });
    const gwCodes = new Set<string>();
    for (const c of circuits) {
      if (!c.gatewayCode) continue;
      const hw = await this.hwRepo.findOne({ where: { code: c.gatewayCode } });
      if (hw?.category === 'power-breaker-web') {
        this.cloudCodes.add(c.code);
        gwCodes.add(c.code);
      }
    }
  }

  // ============ 云电量同步（平台 device-total） ============

  /** 拉取最近 days 天云断路器电量并 upsert（平台电表权威，覆盖） */
  async syncCloud(days = 30): Promise<{ devices: number; rows: number }> {
    if (!this.webBreaker) return { devices: 0, rows: 0 };
    const stime = daysAgoStr(days);
    const etime = todayStr();
    const units = await this.hwRepo.find({ where: { category: 'power-breaker-web' } });
    // hw.code → 回路
    const circuits = await this.circuitRepo.find({ where: { enabled: true } });
    let rows = 0;
    for (const hw of units) {
      const circuit = circuits.find((c) => c.gatewayCode === hw.code);
      if (!circuit) continue;
      try {
        const r = await this.webBreaker.getEnergyTotals(hw.code, stime, etime);
        if (!r.ok || !r.data) {
          this.logger?.warn(`云电量获取失败 ${hw.code}: ${r.error}`, { context: 'EnergyService' });
          continue;
        }
        for (const d of r.data.daily) {
          await this.upsertCloudDay(circuit, d.date, d.kwh);
          rows += 1;
        }
      } catch (err) {
        this.logger?.warn(`云电量同步异常 ${hw.code}: ${(err as Error).message}`, {
          context: 'EnergyService',
        });
      }
    }
    return { devices: units.length, rows };
  }

  private async upsertCloudDay(
    circuit: PowerCircuit,
    date: string,
    kwh: number,
  ): Promise<void> {
    const existing = await this.dailyRepo.findOne({
      where: { circuitCode: circuit.code, date },
    });
    if (existing) {
      existing.kwh = Number(kwh);
      existing.source = 'cloud';
      existing.circuitId = circuit.id;
      await this.dailyRepo.save(existing);
    } else {
      await this.dailyRepo.save(
        this.dailyRepo.create({
          circuitCode: circuit.code,
          circuitId: circuit.id,
          date,
          kwh: Number(kwh),
          source: 'cloud',
          peakPower: null,
        }),
      );
    }
  }

  // ============ 功率积分兜底 ============

  private handleEvent(e: ControlEvent): void {
    if (e.type !== 'power_reading') return;
    if (this.cloudCodes.has(e.code)) return; // 云回路以平台为准
    const atMs = Date.parse(e.at);
    const power = Number(e.reading?.power ?? 0);
    const prev = this.lastSample.get(e.code);
    this.lastSample.set(e.code, { at: atMs, power });
    if (!prev) return; // 首帧只建立基线
    const dtSec = (atMs - prev.at) / 1000;
    // 正常 10s 一帧；缺口过大（重启/离线 >2min）不拿旧功率外推，避免虚高
    if (!Number.isFinite(dtSec) || dtSec <= 0 || dtSec > 120) return;
    const avgPower = (prev.power + power) / 2;
    const deltaWh = (avgPower * dtSec) / 3600;
    if (deltaWh <= 0 && power <= 0) {
      // 仍更新峰值，但零电量不写库
      void this.touchPeak(e.code, e.circuitId, new Date(atMs), power);
      return;
    }
    void this.addIntegral(e.code, e.circuitId, new Date(atMs), deltaWh, power);
  }

  private dateOf(d: Date): string {
    return fmtDate(d);
  }

  private async addIntegral(
    code: string,
    circuitId: number,
    when: Date,
    deltaWh: number,
    power: number,
  ): Promise<void> {
    const date = this.dateOf(when);
    let row = await this.dailyRepo.findOne({ where: { circuitCode: code, date } });
    if (!row) {
      row = this.dailyRepo.create({
        circuitCode: code,
        circuitId,
        date,
        kwh: 0,
        source: 'integral',
        peakPower: power,
      });
    }
    row.kwh = Number((Number(row.kwh) + deltaWh).toFixed(4));
    row.source = 'integral';
    row.peakPower = Math.max(Number(row.peakPower ?? 0), power);
    await this.dailyRepo.save(row);
  }

  private async touchPeak(
    code: string,
    circuitId: number,
    when: Date,
    power: number,
  ): Promise<void> {
    if (power <= 0) return;
    const date = this.dateOf(when);
    let row = await this.dailyRepo.findOne({ where: { circuitCode: code, date } });
    if (!row) {
      row = this.dailyRepo.create({
        circuitCode: code,
        circuitId,
        date,
        kwh: 0,
        source: 'integral',
        peakPower: power,
      });
    }
    if (power > Number(row.peakPower ?? 0)) row.peakPower = power;
    await this.dailyRepo.save(row);
  }

  // ============ 聚合查询 ============

  async overview(): Promise<EnergyOverview> {
    const today = todayStr();
    const yest = daysAgoStr(1);
    const mStart = monthStartStr();
    const rows = await this.dailyRepo.find();
    const sum = (pred: (r: EnergyDaily) => boolean): number =>
      Number(
        rows.filter(pred).reduce((s, r) => s + Number(r.kwh), 0).toFixed(2),
      );
    const totalKwh = sum(() => true);
    const todayKwh = sum((r) => r.date === today);
    const yesterdayKwh = sum((r) => r.date === yest);
    const monthKwh = sum((r) => r.date >= mStart);
    const peakPowerW = Math.max(0, ...rows.map((r) => Number(r.peakPower ?? 0)));
    const circuits = await this.circuitRepo.count({ where: { enabled: true } });
    return {
      totalKwh,
      todayKwh,
      monthKwh,
      yesterdayKwh,
      circuitCount: circuits,
      pricePerKwh: this.pricePerKwh,
      todayCost: Number((todayKwh * this.pricePerKwh).toFixed(2)),
      totalCost: Number((totalKwh * this.pricePerKwh).toFixed(2)),
      peakPowerW: Number(peakPowerW.toFixed(0)),
    };
  }

  /** 园区总用电趋势：groupBy=day（最近 days 天，默认30）或 month（最近12个月） */
  async trend(
    groupBy: 'day' | 'month' = 'day',
    days = 30,
  ): Promise<Array<{ label: string; kwh: number }>> {
    if (groupBy === 'month') {
      const rows = await this.dailyRepo.find();
      const map = new Map<string, number>();
      for (const r of rows) {
        const m = r.date.slice(0, 7); // YYYY-MM
        map.set(m, Number((Number(map.get(m) ?? 0) + Number(r.kwh)).toFixed(2)));
      }
      const out: Array<{ label: string; kwh: number }> = [];
      const d = new Date();
      d.setDate(1);
      for (let i = 11; i >= 0; i -= 1) {
        const t = new Date(d.getFullYear(), d.getMonth() - i, 1);
        const label = `${t.getFullYear()}-${pad(t.getMonth() + 1)}`;
        out.push({ label, kwh: Number(map.get(label) ?? 0) });
      }
      return out;
    }
    const from = daysAgoStr(days);
    const to = todayStr();
    const rows = (await this.dailyRepo.find()).filter(
      (r) => r.date >= from && r.date <= to,
    );
    const map = new Map<string, number>();
    for (const r of rows) map.set(r.date, Number((Number(map.get(r.date) ?? 0) + r.kwh).toFixed(2)));
    const out: Array<{ label: string; kwh: number }> = [];
    for (let i = days; i >= 0; i -= 1) {
      const label = daysAgoStr(i);
      out.push({ label, kwh: Number(map.get(label) ?? 0) });
    }
    return out;
  }

  /** 回路用电占比/排行（最近 days 天） */
  async breakdown(
    days = 30,
  ): Promise<
    Array<{
      code: string;
      name: string;
      category: string;
      icon: string | null;
      source: string;
      kwh: number;
      peakPowerW: number;
    }>
  > {
    const from = daysAgoStr(days);
    const rows = (await this.dailyRepo.find()).filter((r) => r.date >= from);
    const circuits = await this.circuitRepo.find({ where: { enabled: true } });
    const byCode = new Map<
      string,
      { kwh: number; source: string; peak: number }
    >();
    for (const r of rows) {
      const cur = byCode.get(r.circuitCode) ?? { kwh: 0, source: r.source, peak: 0 };
      cur.kwh += Number(r.kwh);
      cur.peak = Math.max(cur.peak, Number(r.peakPower ?? 0));
      // 若区间内任一天为 cloud，标记 cloud
      if (r.source === 'cloud') cur.source = 'cloud';
      byCode.set(r.circuitCode, cur);
    }
    const out = circuits
      .map((c) => {
        const agg = byCode.get(c.code);
        return {
          code: c.code,
          name: c.name,
          category: c.category,
          icon: c.icon,
          source: agg?.source ?? 'none',
          kwh: Number((agg?.kwh ?? 0).toFixed(2)),
          peakPowerW: Number((agg?.peak ?? 0).toFixed(0)),
        };
      })
      .filter((x) => x.kwh > 0)
      .sort((a, b) => b.kwh - a.kwh);
    return out;
  }

  // ============ 园区能源台账（后台可维护） ============

  /** 读取当前生效台账（后台维护优先，否则默认）。 */
  async getAssets(): Promise<{
    revision: number;
    schemaVersion: number;
    value: EnergyAssets;
    isDefault: boolean;
  }> {
    const snap = await this.runtimeConfig.read(
      ENERGY_ASSETS_KEY,
      normalizeEnergyAssets,
    );
    if (snap) {
      return {
        revision: snap.revision,
        schemaVersion: snap.schemaVersion,
        value: snap.value,
        isDefault: false,
      };
    }
    return {
      revision: 0,
      schemaVersion: ENERGY_ASSETS_SCHEMA_VERSION,
      value: defaultEnergyAssets(),
      isDefault: true,
    };
  }

  /** 保存台账（CAS：expectedRevision 与当前不一致返回 409）。 */
  async saveAssets(
    value: unknown,
    expectedRevision: number,
    actor?: string,
  ): Promise<{ revision: number; schemaVersion: number; value: EnergyAssets }> {
    // 确保种子存在（幂等），并以其 revision 作为乐观锁基准。
    const seeded = await this.runtimeConfig.initialize({
      key: ENERGY_ASSETS_KEY,
      schemaVersion: ENERGY_ASSETS_SCHEMA_VERSION,
      value: defaultEnergyAssets(),
      normalize: normalizeEnergyAssets,
      actor: 'system',
      source: 'energy-bootstrap',
    });
    if (Number(expectedRevision) !== seeded.revision) {
      throw new ConflictException({
        code: 'RUNTIME_CONFIG_REVISION_CONFLICT',
        key: ENERGY_ASSETS_KEY,
        expectedRevision,
        actualRevision: seeded.revision,
      });
    }
    const snap = await this.runtimeConfig.update({
      key: ENERGY_ASSETS_KEY,
      schemaVersion: ENERGY_ASSETS_SCHEMA_VERSION,
      value,
      normalize: normalizeEnergyAssets,
      expectedRevision: seeded.revision,
      actor: actor ?? 'admin',
      source: 'energy-admin',
    });
    return {
      revision: snap.revision,
      schemaVersion: snap.schemaVersion,
      value: snap.value,
    };
  }

  // ============ 运营大屏能源中心聚合（一次返回全部区块） ============

  async dashboard() {
    const [ov, trend, bd] = await Promise.all([
      this.overview(),
      this.trend('day', 30),
      this.breakdown(30),
    ]);
    const pv = this.pv.getOverview();
    const assets = await this.getAssets();
    const park = buildParkEnergyModel(assets.value);

    const pvToday = pv.totals?.todayKwh ?? 0;
    const pvMonth = pv.totals?.monthKwh ?? 0;
    const parkToday = park.totals.todayKwh;
    const parkMonth = park.totals.monthKwh;
    // 光伏按自发自用抵扣（余电上网另计），净购电不低于 0。
    const gridToday = Math.max(0, Math.round((parkToday - pvToday) * 100) / 100);
    const gridMonth = Math.max(0, Math.round((parkMonth - pvMonth) * 100) / 100);
    const selfSufficiencyPct =
      parkToday > 0
        ? Math.round((Math.min(pvToday, parkToday) / parkToday) * 1000) / 10
        : 0;
    const headline = {
      parkTodayKwh: parkToday,
      parkMonthKwh: parkMonth,
      pvTodayKwh: Math.round(pvToday * 100) / 100,
      pvMonthKwh: Math.round(pvMonth * 100) / 100,
      gridTodayKwh: gridToday,
      gridMonthKwh: gridMonth,
      selfSufficiencyPct,
      todayCost: Math.round(gridToday * this.pricePerKwh * 100) / 100,
      monthCost: Math.round(gridMonth * this.pricePerKwh * 100) / 100,
      pvSavingToday: Math.round(pvToday * this.pricePerKwh * 100) / 100,
      carbonMonthT: pv.totals?.monthCarbonT ?? 0,
    };

    return {
      generatedAt: new Date().toISOString(),
      pricePerKwh: this.pricePerKwh,
      headline,
      measured: { overview: ov, trend, breakdown: bd },
      pv,
      park,
    };
  }
}
