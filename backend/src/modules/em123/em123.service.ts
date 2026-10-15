import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RootConfig, Em123Config } from '../../common/config/configuration';
import { Em123Meter } from '../../entities/em123-meter.entity';
import { Em123Daily } from '../../entities/em123-daily.entity';
import { Em123Hourly } from '../../entities/em123-hourly.entity';
import {
  Em123Client,
  type Em123MeterRaw,
  type Em123UsageRaw,
  type Em123HourlyRaw,
} from './em123.client';
import {
  num,
  round1,
  parseMeterLocation,
  subMeterTag,
} from './em123.mapping';

/** 日用量批量 upsert 每批行数 (避开 SQLite 表达式树深度上限 1000)。 */
const DAILY_UPSERT_BATCH = 400;
/** 小时记录批量 upsert 每批行数。 */
const HOURLY_UPSERT_BATCH = 400;
/** 负荷曲线取最近多少个整点点 (滚动 24 小时)。 */
const LOAD_CURVE_POINTS = 24;
/** 聚合时回溯多少天的小时记录 (>=2 天, 保证跨天拿到最近 24 点)。 */
const LOAD_LOOKBACK_DAYS = 2;

/** 单块表视图 (下钻明细)。 */
export interface Em123MeterView {
  meterNo: string;
  type: 'E' | 'W';
  name: string;
  zone: string | null;
  areaGroup: string | null;
  building: string | null;
  buildingName: string;
  room: string | null;
  kind: 'master' | 'household';
  tag: string | null;
  modelName: string | null;
  multiply: number;
  /** 原始字轮读数 */
  readingValue: number;
  /** 折算后累计读数 (电 kWh / 水 t) */
  reading: number;
  readingTime: string | null;
  today: number;
  month: number;
  /** 账户余额 (元) */
  money: number;
  /** 分户表是否欠费 (余额<0) */
  arrears: boolean;
  online: boolean;
  /** 是否拉闸/关阀 (meterStatus='1') */
  cutOff: boolean;
  alarm: string | null;
}

export interface Em123Group {
  key: string;
  name: string;
  zone: string | null;
  /** master=总表组 / household=分户组 / mixed=总/分混合 */
  kind: 'master' | 'household' | 'mixed';
  meterCount: number;
  online: number;
  offline: number;
  /** 欠费户数(仅分户) */
  arrears: number;
  /** 拉闸/关阀数 */
  cutOff: number;
  masterReading: number;
  householdReading: number;
  masterToday: number;
  householdToday: number;
  masterMonth: number;
  householdMonth: number;
  today: number;
  month: number;
  meters: Em123MeterView[];
}

export interface Em123Zone {
  zone: string;
  name: string;
  buildingCount: number;
  meterCount: number;
  today: number;
  month: number;
  totalReading: number;
  buildings: { key: string; name: string; month: number; today: number }[];
}

export interface Em123TypeSummary {
  type: 'E' | 'W';
  unit: string;
  totalMeters: number;
  online: number;
  offline: number;
  /** 欠费户数(分户) */
  arrears: number;
  /** 拉闸/关阀数 */
  cutOff: number;
  masterCount: number;
  householdCount: number;
  today: number;
  month: number;
  totalReading: number;
  master: { count: number; today: number; month: number; totalReading: number };
  household: { count: number; today: number; month: number; totalReading: number };
  /** 总表口径 vs 分户口径差额(本月); 仅同区域总/分都有意义时参考 */
  monthDiff: number;
  /** 字母分区 (A/B/C/D/E) */
  zones: Em123Zone[];
  /** 全部楼栋/区域分组 (不含逐表明细, 按本月用量降序) */
  groups: Em123Group[];
  /** 近 30 天日用量序列 */
  daySeries: { date: string; value: number }[];
  /** 近 6 月月度用量序列 */
  monthSeries: { month: string; value: number }[];
  /** 平台日用量最近一天 (结算可能滞后) */
  latestDate: string | null;
}

/** 关口总表小时负荷曲线单点。 */
export interface Em123LoadPoint {
  /** 整点小时桶 0-23 */
  hour: number;
  /** 该小时平均功率 kW (小时用量/间隔小时) */
  kw: number;
  /** 实际抄表时刻 HH:MM */
  time: string;
}

/** 单块三相关口总表的真实小时负荷。 */
export interface Em123LoadMeter {
  meterNo: string;
  name: string;
  zone: string | null;
  buildingName: string;
  tag: string | null;
  multiply: number;
  /** 最近 24 小时负荷曲线 (时间正序) */
  curve: Em123LoadPoint[];
  /** 峰值小时平均功率 kW */
  peakKw: number;
  /** 全天(24h)平均功率 kW */
  avgKw: number;
  /** 最近 24 小时用电量 kWh */
  dayKwh: number;
  /** 最新抄表时刻 */
  latestTime: string | null;
  online: boolean;
}

/** 三相关口总表小时负荷汇总 (变压器/区域真实负荷, 零硬件)。 */
export interface Em123LoadSummary {
  enabled: boolean;
  updatedAt: string | null;
  /** 三相关口总表数 */
  meterCount: number;
  /** 各关口总表负荷 (按峰值降序) */
  meters: Em123LoadMeter[];
}

export interface Em123Overview {
  enabled: boolean;
  ok: boolean;
  loading: boolean;
  stale: boolean;
  updatedAt: string | null;
  error: string | null;
  electric: Em123TypeSummary | null;
  water: Em123TypeSummary | null;
  /** 三相关口总表小时负荷 (变压器面板真实口径; 无则 null) */
  load: Em123LoadSummary | null;
}

function emptyOverview(enabled: boolean, loading: boolean): Em123Overview {
  return {
    enabled,
    ok: false,
    loading: enabled && loading,
    stale: false,
    updatedAt: null,
    error: null,
    electric: null,
    water: null,
    load: null,
  };
}

const TYPE_UNIT: Record<'E' | 'W', string> = { E: 'kWh', W: 't' };
const ZONE_LABEL: Record<string, string> = {
  A: 'A区',
  B: 'B区',
  C: 'C区',
  D: 'D区',
  E: 'E区',
};

/** 本地日期串 (YYYY-MM-DD), 规避 toISOString 的 UTC 偏移 (CST 早晨 UTC 仍在前一天)。 */
function localDateStr(d: Date = new Date()): string {
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** 近 N 天日期串 (本地, YYYY-MM-DD), 含今天。 */
function daysBack(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    out.push(localDateStr(d));
  }
  return out;
}

/** 日期串加减天数 (本地, 规避 toISOString 的 UTC 偏移)。 */
function addDaysLocal(dateStr: string, n: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + n);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())}`;
}

/** 两次抄表间隔小时数 (YYYY-MM-DD HH:MM:SS)。仅在 20min~2h 内视为有效整点间隔, 否则按 1 小时兜底。 */
function intervalHours(lastTime: string | null | undefined, readingTime: string): number {
  if (!lastTime) return 1;
  const parse = (s: string) => new Date(s.replace(' ', 'T')).getTime();
  const a = parse(lastTime);
  const b = parse(readingTime);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 1;
  const h = (b - a) / 3_600_000;
  return h > 1 / 3 && h <= 2 ? h : 1;
}

@Injectable()
export class Em123Service implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(Em123Service.name);
  private readonly cfg: Em123Config;
  private client: Em123Client | null = null;
  private meterTimer: ReturnType<typeof setInterval> | null = null;
  private dailyTimer: ReturnType<typeof setInterval> | null = null;
  private hourlyTimer: ReturnType<typeof setInterval> | null = null;
  private inflightMeters = false;
  private inflightDaily = false;
  private inflightHourly = false;
  private booted = false;
  private cache: Em123Overview = emptyOverview(false, false);

  constructor(
    private readonly config: ConfigService<RootConfig>,
    @InjectRepository(Em123Meter) private readonly meterRepo: Repository<Em123Meter>,
    @InjectRepository(Em123Daily) private readonly dailyRepo: Repository<Em123Daily>,
    @InjectRepository(Em123Hourly) private readonly hourlyRepo: Repository<Em123Hourly>,
  ) {
    this.cfg = this.config.getOrThrow<Em123Config>('em123');
    if (this.cfg.enabled) {
      this.client = new Em123Client({
        baseUrl: this.cfg.baseUrl,
        username: this.cfg.username,
        password: this.cfg.password,
        timeoutMs: this.cfg.timeoutMs,
      });
    }
  }

  onModuleInit(): void {
    if (!this.cfg.enabled || !this.client) {
      this.logger.log('em123 未配置(缺 EM123_USERNAME/PASSWORD)或被停用, 接口返回 disabled');
      return;
    }
    void this.bootstrap();
    this.meterTimer = setInterval(() => void this.syncMeters(), this.cfg.refreshMetersMs);
    this.dailyTimer = setInterval(() => void this.syncDaily(3), this.cfg.refreshDailyMs);
    this.hourlyTimer = setInterval(() => void this.syncHourly(LOAD_LOOKBACK_DAYS), this.cfg.refreshHourlyMs);
    this.meterTimer?.unref?.();
    this.dailyTimer?.unref?.();
    this.hourlyTimer?.unref?.();
  }

  onModuleDestroy(): void {
    if (this.meterTimer) clearInterval(this.meterTimer);
    if (this.dailyTimer) clearInterval(this.dailyTimer);
    if (this.hourlyTimer) clearInterval(this.hourlyTimer);
  }

  /** 启动回填: 表档案 → 历史日用量 → 关口总表小时负荷 → 重建缓存。 */
  async bootstrap(): Promise<void> {
    if (!this.client) return;
    try {
      await this.syncMeters();
      await this.syncDaily(this.cfg.bootstrapDays);
      await this.syncHourly(this.cfg.bootstrapHourlyDays);
      this.booted = true;
      this.logger.log('em123 启动回填完成');
    } catch (error) {
      this.logger.warn(`em123 启动回填失败: ${(error as Error).message}`);
    }
  }

  /** 手动触发全量同步 (管理员接口用)。 */
  async syncNow(days = 30): Promise<void> {
    await this.syncMeters();
    await this.syncDaily(days);
    await this.syncHourly(LOAD_LOOKBACK_DAYS);
  }

  // ==================== 同步 ====================

  /** 拉取电/水表档案与最新状态, upsert。 */
  async syncMeters(): Promise<void> {
    if (!this.client || this.inflightMeters) return;
    this.inflightMeters = true;
    try {
      const [eRows, wRows] = await Promise.all([
        this.client.fetchMeters('E'),
        this.client.fetchMeters('W'),
      ]);
      const rows: Em123MeterRaw[] = [...eRows, ...wRows];
      let order = 0;
      for (const r of rows) {
        const meterNo = String(r.meterNo ?? '').trim();
        if (!meterNo) continue;
        const meterType = String(r.meterType ?? '').toUpperCase() === 'W' ? 'W' : 'E';
        const houseName = String(r.houseName ?? '').trim();
        const loc = parseMeterLocation({
          meterType,
          modelName: String(r.modelName ?? ''),
          houseName,
        });
        const multiply = num(r.multiply) || 1;
        const readingValue = num(r.readingValue);
        const readingKwh = round1(readingValue * multiply);
        await this.meterRepo.upsert(
          {
            meterNo,
            meterType,
            meterName: houseName || meterNo,
            houseId: r.houseId !== undefined && r.houseId !== null ? String(r.houseId) : null,
            zone: loc.zone,
            areaGroup: loc.areaGroup,
            building: loc.building,
            buildingName: loc.buildingName,
            room: loc.room,
            kind: loc.kind,
            meterModel: r.meterModel !== undefined ? String(r.meterModel) : null,
            modelName: r.modelName !== undefined ? String(r.modelName) : null,
            deviceImei: r.deviceImei !== undefined ? String(r.deviceImei) : null,
            connType: r.connType !== undefined ? String(r.connType) : null,
            multiply,
            priceName: r.priceName !== undefined ? String(r.priceName) : null,
            readingValue,
            readingKwh,
            readingTime: r.readingTime !== undefined ? String(r.readingTime) : null,
            chargeMoney: num(r.chargeMoney),
            onlineStatus: String(r.onlineStatus ?? 'offline').toLowerCase(),
            meterStatus: r.meterStatus !== undefined && r.meterStatus !== null ? String(r.meterStatus) : null,
            alarmName: r.alarmName ? String(r.alarmName) : null,
            sortOrder: order++,
          },
          ['meterNo'],
        );
      }
      await this.rebuild();
      this.logger.log(`em123 表档案同步完成: 电 ${eRows.length} / 水 ${wRows.length}`);
    } finally {
      this.inflightMeters = false;
    }
  }

  /**
   * 拉取区间内全量日用量并 upsert, 然后重建缓存。
   * 按自然月分块: 实测平台查询 endTime 一旦跨月, 下个月数据会被丢弃(只返回 beginTime 所在月),
   * 故每块严格限制在同一自然月内(月初~月末, 首/尾块按 begin/end 裁剪); 每块拉完立即批量入库,
   * 单块失败不影响其他块, 且能边拉边写、便于观测进度。
   */
  async syncDaily(days: number): Promise<void> {
    if (!this.client || this.inflightDaily) return;
    this.inflightDaily = true;
    try {
      const dates = daysBack(days);
      const begin = dates[0];
      const end = localDateStr();
      // 日用量行 meterType 为空, 以表档案为准建立 meterNo → type 映射, 只入库本园区表
      const meterRefs = await this.meterRepo.find({
        select: { meterNo: true, meterType: true },
      });
      const typeMap = new Map(meterRefs.map((m) => [m.meterNo, m.meterType]));
      const pad = (x: number) => String(x).padStart(2, '0');
      let fetched = 0;
      let written = 0;
      let skipped = 0;
      let cursor = begin;
      while (cursor <= end) {
        const [y, m] = cursor.split('-').map(Number);
        const lastDay = new Date(y, m, 0).getDate(); // m 为 1-based, 该自然月最后一天
        const monthEnd = `${y}-${pad(m)}-${pad(lastDay)}`;
        const chunkEnd = monthEnd > end ? end : monthEnd;
        // 单块最多尝试 3 次, 平台偶发慢/超时不致整块丢失; 3 次仍失败则跳过继续
        let part: Em123UsageRaw[] | null = null;
        for (let attempt = 1; attempt <= 3 && part === null; attempt++) {
          try {
            part = await this.client.fetchUsage(cursor, chunkEnd);
          } catch (err) {
            this.logger.warn(
              `em123 日用量块 ${cursor}~${chunkEnd} 第${attempt}次失败: ${(err as Error).message}`,
            );
            if (attempt === 3) part = [];
          }
        }
        const entities: Em123Daily[] = [];
        for (const r of part ?? []) {
          const meterNo = String(r.meterNo ?? '').trim();
          const date = String(r.reportMonth ?? '').slice(0, 10);
          if (!meterNo || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
          const meterType = typeMap.get(meterNo);
          if (meterType !== 'E' && meterType !== 'W') {
            skipped++;
            continue;
          }
          entities.push({
            meterNo,
            meterType,
            date,
            useLimit: round1(num(r.useLimit)),
            useMoney: round1(num(r.useMoney)),
            startValue: r.minValue !== undefined ? num(r.minValue) : null,
            endValue: r.maxValue !== undefined ? num(r.maxValue) : null,
          } as Em123Daily);
        }
        // 分批 upsert: 单块最多 ~3150 行, 一次写入会触发 SQLite 表达式树深度上限(1000)
        for (let i = 0; i < entities.length; i += DAILY_UPSERT_BATCH) {
          await this.dailyRepo.manager.upsert(
            Em123Daily,
            entities.slice(i, i + DAILY_UPSERT_BATCH),
            ['meterNo', 'date'],
          );
        }
        fetched += part?.length ?? 0;
        written += entities.length;
        this.logger.log(
          `em123 日用量块 ${cursor}~${chunkEnd}: 拉取 ${part?.length ?? 0} 行, 入库 ${entities.length}`,
        );
        if (chunkEnd === end) break;
        cursor = addDaysLocal(chunkEnd, 1);
      }
      await this.rebuild();
      this.logger.log(
        `em123 日用量同步完成: 区间 ${begin}~${end}, 拉取 ${fetched} 行 (写入 ${written}, 跳过非本园区 ${skipped})`,
      );
    } finally {
      this.inflightDaily = false;
    }
  }

  /**
   * 拉取三相关口总表(电 master)每小时定时抄表记录并 upsert, 然后重建缓存。
   * 零硬件还原小时负荷: 平台每小时一条定时记录, useLimit 已是该小时用量(已乘倍率),
   * 除以实际间隔小时数即小时平均功率(kW)。仅拉三相总表(12 块), 按自然月分块、逐表调用
   * (/record/meter/list 为单表查询), 边拉边写, 单表/单块失败不影响其他。
   */
  async syncHourly(days: number): Promise<void> {
    if (!this.client || this.inflightHourly) return;
    this.inflightHourly = true;
    try {
      const end = localDateStr();
      const begin = daysBack(days)[0];
      const masters = await this.meterRepo.find({
        where: { meterType: 'E', kind: 'master' },
        order: { sortOrder: 'ASC' },
      });
      const pad = (x: number) => String(x).padStart(2, '0');
      let written = 0;
      for (const m of masters) {
        const entities: Em123Hourly[] = [];
        let cursor = begin;
        while (cursor <= end) {
          const [y, mo] = cursor.split('-').map(Number);
          const lastDay = new Date(y, mo, 0).getDate();
          const monthEnd = `${y}-${pad(mo)}-${pad(lastDay)}`;
          const chunkEnd = monthEnd > end ? end : monthEnd;
          let part: Em123HourlyRaw[] | null = null;
          for (let attempt = 1; attempt <= 3 && part === null; attempt++) {
            try {
              part = await this.client.fetchHourlyRecords(m.meterNo, cursor, chunkEnd);
            } catch (err) {
              this.logger.warn(
                `em123 小时负荷 ${m.meterNo} 块 ${cursor}~${chunkEnd} 第${attempt}次失败: ${(err as Error).message}`,
              );
              if (attempt === 3) part = [];
            }
          }
          for (const r of part ?? []) {
            const readingTime = String(r.readingTime ?? '').trim();
            if (!/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(readingTime)) continue;
            const hourUse = round1(num(r.useLimit));
            const hours = intervalHours(r.lastTime ? String(r.lastTime) : null, readingTime);
            const hourAvgKw = hours > 0 ? round1(hourUse / hours) : hourUse;
            entities.push({
              meterNo: m.meterNo,
              meterType: 'E',
              readingTime,
              readingValue: round1(num(r.readingValue)),
              hourUse,
              hourAvgKw,
              useMoney: round1(num(r.useMoney)),
              csq: r.csq !== undefined && r.csq !== null && r.csq !== '' ? String(r.csq) : null,
              readingType: '0',
            } as Em123Hourly);
          }
          if (chunkEnd === end) break;
          cursor = addDaysLocal(chunkEnd, 1);
        }
        for (let i = 0; i < entities.length; i += HOURLY_UPSERT_BATCH) {
          await this.hourlyRepo.manager.upsert(
            Em123Hourly,
            entities.slice(i, i + HOURLY_UPSERT_BATCH),
            ['meterNo', 'readingTime'],
          );
        }
        written += entities.length;
        this.logger.log(`em123 小时负荷 ${m.meterNo}(${m.meterName}): 入库 ${entities.length} 条`);
      }
      await this.rebuild();
      this.logger.log(
        `em123 小时负荷同步完成: 区间 ${begin}~${end}, 关口总表 ${masters.length} 块, 写入 ${written} 条`,
      );
    } finally {
      this.inflightHourly = false;
    }
  }

  // ==================== 聚合 ====================

  /** 从库表重建电/水视图缓存与关口总表小时负荷。 */
  private async rebuild(): Promise<void> {
    try {
      const since = daysBack(183)[0];
      const hourlySince = daysBack(LOAD_LOOKBACK_DAYS)[0];
      const [meters, dailyRows, hourlyRows] = await Promise.all([
        this.meterRepo.find(),
        this.dailyRepo
          .createQueryBuilder('d')
          .where('d.date >= :s', { s: since })
          .getMany(),
        this.hourlyRepo
          .createQueryBuilder('h')
          .where('h.reading_time >= :s', { s: hourlySince })
          .getMany(),
      ]);
      const electric = buildSummary('E', meters, dailyRows);
      const water = buildSummary('W', meters, dailyRows);
      const load = buildLoadSummary(meters, hourlyRows);
      this.cache = {
        enabled: true,
        ok: true,
        loading: false,
        stale: false,
        updatedAt: new Date().toISOString(),
        error: null,
        electric,
        water,
        load,
      };
    } catch (error) {
      this.logger.warn(`em123 聚合失败: ${(error as Error).message}`);
      if (this.cache) this.cache = { ...this.cache, stale: true, error: (error as Error).message };
    }
  }

  getOverview(): Em123Overview {
    if (!this.cfg.enabled) return emptyOverview(false, false);
    if (!this.cache.updatedAt && !this.cache.error) {
      return { ...emptyOverview(true, true) };
    }
    return this.cache;
  }

  /** 下钻树: 分区→楼栋/区域→表明细。 */
  async getTree(type: 'E' | 'W'): Promise<Em123TypeSummary | null> {
    const summary = buildSummary(type, await this.meterRepo.find(), await this.dailyRepo
      .createQueryBuilder('d')
      .where('d.date >= :s', { s: daysBack(183)[0] })
      .andWhere('d.meter_type = :t', { t: type })
      .getMany(), true);
    return summary;
  }
}

/**
 * 纯函数: 由表档案 + 日用量构建某一类型(电/水)的完整视图。
 * includeMeters=false 时 groups 不含逐表明细 (overview 用); true 时含 (下钻 tree 用)。
 */
export function buildSummary(
  type: 'E' | 'W',
  meters: Em123Meter[],
  daily: Em123Daily[],
  includeMeters = false,
): Em123TypeSummary {
  const today = localDateStr();
  const month = today.slice(0, 7);
  const daySet = daysBack(30);

  // 每块表今日/本月用量
  const todayMap = new Map<string, number>();
  const monthMap = new Map<string, number>();
  const dayMap = new Map<string, number>();
  const monthSeriesMap = new Map<string, number>();
  let latestDate: string | null = null;

  for (const d of daily) {
    if (d.meterType !== type) continue;
    const v = num(d.useLimit);
    if (d.date === today) todayMap.set(d.meterNo, (todayMap.get(d.meterNo) ?? 0) + v);
    if (d.date.startsWith(month)) monthMap.set(d.meterNo, (monthMap.get(d.meterNo) ?? 0) + v);
    if (daySet.includes(d.date)) dayMap.set(d.date, (dayMap.get(d.date) ?? 0) + v);
    const mm = d.date.slice(0, 7);
    monthSeriesMap.set(mm, (monthSeriesMap.get(mm) ?? 0) + v);
    if (!latestDate || d.date > latestDate) latestDate = d.date;
  }

  const typeMeters = meters.filter((m) => m.meterType === type);
  const groupMap = new Map<string, Em123Group & { meters: Em123MeterView[] }>();
  let online = 0;
  let offline = 0;
  let arrears = 0;
  let cutOff = 0;
  let masterCount = 0;
  let householdCount = 0;
  const totals = {
    today: 0,
    month: 0,
    reading: 0,
    masterToday: 0,
    masterMonth: 0,
    masterReading: 0,
    householdToday: 0,
    householdMonth: 0,
    householdReading: 0,
  };

  const meterViews: Em123MeterView[] = [];

  for (const m of typeMeters) {
    const isOnline = m.onlineStatus === 'online';
    if (isOnline) online++;
    else offline++;
    const isCutOff = m.meterStatus === '1';
    if (isCutOff) cutOff++;
    const isHousehold = m.kind === 'household';
    const isArrears = isHousehold && m.chargeMoney < 0;
    if (isArrears) arrears++;
    if (m.kind === 'master') masterCount++;
    else householdCount++;

    const t = round1(todayMap.get(m.meterNo) ?? 0);
    const mo = round1(monthMap.get(m.meterNo) ?? 0);
    const reading = round1(m.readingKwh);
    totals.today += t;
    totals.month += mo;
    totals.reading += reading;
    if (m.kind === 'master') {
      totals.masterToday += t;
      totals.masterMonth += mo;
      totals.masterReading += reading;
    } else {
      totals.householdToday += t;
      totals.householdMonth += mo;
      totals.householdReading += reading;
    }

    const view: Em123MeterView = {
      meterNo: m.meterNo,
      type,
      name: m.meterName,
      zone: m.zone,
      areaGroup: m.areaGroup,
      building: m.building,
      buildingName: m.buildingName ?? '',
      room: m.room,
      kind: m.kind as 'master' | 'household',
      tag: subMeterTag(m.meterName),
      modelName: m.modelName,
      multiply: m.multiply,
      readingValue: round1(m.readingValue),
      reading,
      readingTime: m.readingTime,
      today: t,
      month: mo,
      money: round1(m.chargeMoney),
      arrears: isArrears,
      online: isOnline,
      cutOff: isCutOff,
      alarm: m.alarmName,
    };
    meterViews.push(view);

    // 归属分组: 字母分区用 building, 公寓区用 areaGroup
    const gk = m.zone ? m.building ?? '其他' : m.areaGroup ?? '其他';
    let g = groupMap.get(gk);
    if (!g) {
      g = {
        key: gk,
        name: m.buildingName ?? gk,
        zone: m.zone,
        kind: m.kind as 'master' | 'household',
        meterCount: 0,
        online: 0,
        offline: 0,
        arrears: 0,
        cutOff: 0,
        masterReading: 0,
        householdReading: 0,
        masterToday: 0,
        householdToday: 0,
        masterMonth: 0,
        householdMonth: 0,
        today: 0,
        month: 0,
        meters: [],
      };
      groupMap.set(gk, g);
    }
    g.meterCount++;
    if (isOnline) g.online++;
    else g.offline++;
    if (isArrears) g.arrears++;
    if (isCutOff) g.cutOff++;
    g.today += t;
    g.month += mo;
    if (m.kind === 'master') {
      g.masterReading += reading;
      g.masterToday += t;
      g.masterMonth += mo;
    } else {
      g.householdReading += reading;
      g.householdToday += t;
      g.householdMonth += mo;
    }
    if (g.kind !== m.kind) g.kind = 'mixed';
  }

  // 组内明细 (下钻)
  for (const v of meterViews) {
    const gk = v.zone ? v.building ?? '其他' : v.areaGroup ?? '其他';
    const g = groupMap.get(gk);
    if (g && includeMeters) {
      g.meters.push(v);
    }
  }
  for (const g of groupMap.values()) {
    g.today = round1(g.today);
    g.month = round1(g.month);
    g.masterReading = round1(g.masterReading);
    g.householdReading = round1(g.householdReading);
    g.masterToday = round1(g.masterToday);
    g.householdToday = round1(g.householdToday);
    g.masterMonth = round1(g.masterMonth);
    g.householdMonth = round1(g.householdMonth);
    if (includeMeters) {
      g.meters.sort((a, b) => {
        if (a.kind !== b.kind) return a.kind === 'master' ? -1 : 1;
        return (a.room ?? a.meterNo).localeCompare(b.room ?? b.meterNo);
      });
    }
  }

  // 字母分区聚合
  const zoneMap = new Map<string, Em123Zone>();
  for (const g of groupMap.values()) {
    if (!g.zone) continue;
    let z = zoneMap.get(g.zone);
    if (!z) {
      z = {
        zone: g.zone,
        name: ZONE_LABEL[g.zone] ?? `${g.zone}区`,
        buildingCount: 0,
        meterCount: 0,
        today: 0,
        month: 0,
        totalReading: 0,
        buildings: [],
      };
      zoneMap.set(g.zone, z);
    }
    z.buildingCount++;
    z.meterCount += g.meterCount;
    z.today += g.today;
    z.month += g.month;
    z.totalReading += g.masterReading + g.householdReading;
    z.buildings.push({ key: g.key, name: g.name, month: g.month, today: g.today });
  }
  const zones = [...zoneMap.values()].sort((a, b) => a.zone.localeCompare(b.zone));
  for (const z of zones) {
    z.today = round1(z.today);
    z.month = round1(z.month);
    z.totalReading = round1(z.totalReading);
    z.buildings.sort((a, b) => b.month - a.month);
  }

  // 全部分组 (楼栋+区域), 按本月用量降序
  const groups = [...groupMap.values()].sort((a, b) => b.month - a.month);

  // 近 30 天日序列 (补零)
  const daySeries = daySet.map((d) => ({ date: d, value: round1(dayMap.get(d) ?? 0) }));
  // 近 6 月月序列
  const months6: string[] = [];
  const base = new Date();
  for (let i = 5; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    months6.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  const monthSeries = months6.map((mm) => ({ month: mm, value: round1(monthSeriesMap.get(mm) ?? 0) }));

  return {
    type,
    unit: TYPE_UNIT[type],
    totalMeters: typeMeters.length,
    online,
    offline,
    arrears,
    cutOff,
    masterCount,
    householdCount,
    today: round1(totals.today),
    month: round1(totals.month),
    totalReading: round1(totals.reading),
    master: {
      count: masterCount,
      today: round1(totals.masterToday),
      month: round1(totals.masterMonth),
      totalReading: round1(totals.masterReading),
    },
    household: {
      count: householdCount,
      today: round1(totals.householdToday),
      month: round1(totals.householdMonth),
      totalReading: round1(totals.householdReading),
    },
    monthDiff: round1(totals.masterMonth - totals.householdMonth),
    zones,
    groups,
    daySeries,
    monthSeries,
    latestDate,
  };
}

/**
 * 纯函数: 由表档案 + 近 2 天小时记录, 构建三相关口总表的真实小时负荷汇总。
 * 每块关口表取最近 24 条定时抄表(滚动 24h) → 负荷曲线 / 峰值 / 全天平均 / 近 24h 用电。
 * 负荷仅按各关口表独立呈现(不做总加), 避免上下级表重复计量; 负载率% 待变压器容量
 * 与表-变压器对应关系现场核定后再计算。
 */
export function buildLoadSummary(meters: Em123Meter[], hourly: Em123Hourly[]): Em123LoadSummary {
  const masters = meters.filter((m) => m.meterType === 'E' && m.kind === 'master');
  const byMeter = new Map<string, Em123Hourly[]>();
  for (const h of hourly) {
    if (h.meterType !== 'E') continue;
    const arr = byMeter.get(h.meterNo) ?? [];
    arr.push(h);
    byMeter.set(h.meterNo, arr);
  }

  const views: Em123LoadMeter[] = masters.map((m) => {
    const rows = (byMeter.get(m.meterNo) ?? [])
      .sort((a, b) => (a.readingTime < b.readingTime ? -1 : 1))
      .slice(-LOAD_CURVE_POINTS);
    const curve: Em123LoadPoint[] = rows.map((h) => ({
      hour: Number(h.readingTime.slice(11, 13)),
      kw: num(h.hourAvgKw),
      time: h.readingTime.slice(11, 16),
    }));
    const dayKwh = round1(curve.reduce((s, p) => s + p.kw, 0));
    const peakKw = curve.length ? Math.max(...curve.map((p) => p.kw)) : 0;
    // 全天平均负荷: 固定按 24 小时窗口摊 (缺失小时按 0, 与"全天平均负载"口径一致)
    const avgKw = round1(dayKwh / LOAD_CURVE_POINTS);
    const latest = rows.length ? rows[rows.length - 1].readingTime : null;
    return {
      meterNo: m.meterNo,
      name: m.meterName,
      zone: m.zone,
      buildingName: m.buildingName ?? '',
      tag: subMeterTag(m.meterName),
      multiply: m.multiply,
      curve,
      peakKw: round1(peakKw),
      avgKw,
      dayKwh,
      latestTime: latest,
      online: m.onlineStatus === 'online',
    };
  });

  views.sort((a, b) => b.peakKw - a.peakKw || b.dayKwh - a.dayKwh);
  return {
    enabled: true,
    updatedAt: new Date().toISOString(),
    meterCount: masters.length,
    meters: views,
  };
}
