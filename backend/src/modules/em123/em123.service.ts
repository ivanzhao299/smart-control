import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RootConfig, Em123Config } from '../../common/config/configuration';
import type { Actor } from '../../common/auth/actor';
import { Em123Meter } from '../../entities/em123-meter.entity';
import { Em123Daily } from '../../entities/em123-daily.entity';
import { Em123Hourly } from '../../entities/em123-hourly.entity';
import {
  Em123WriteLog,
  type Em123WriteBizType,
  type Em123WriteStatus,
} from '../../entities/em123-write-log.entity';
import {
  Em123Client,
  type Em123MeterRaw,
  type Em123UsageRaw,
  type Em123HourlyRaw,
  type Em123RawRow,
  type Em123ExportFile,
  type Em123WriteResult,
  type Em123WriteUnconfirmedError,
  type Em123SetRateForm,
} from './em123.client';
import {
  num,
  round1,
  round2,
  parseMeterLocation,
  subMeterTag,
} from './em123.mapping';
import {
  TRANSFORMERS,
  THREE_PHASE_TOTAL,
  ASSUMED_POWER_FACTOR,
  type TransformerMode,
} from './em123.transformers';
import {
  validateChargeAmount,
  validateRefundAmount,
  validateReductionAmount,
  validateSwitchControl,
  validateNamedConfirm,
  canRemoteControl,
} from './em123.write-rules';

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

/** 单台变压器视图 (台账 + 已接入回路逐小时加总)。 */
export interface Em123TransformerView {
  id: string;
  /** 额定容量 kVA */
  capacityKva: number;
  location: string;
  /** 箱式油变 / 油变 */
  tfType: string;
  active: boolean;
  mode: TransformerMode;
  /** 归属的已上云三相表数 (含离线) */
  meterCount: number;
  /** 其中在线数 */
  onlineMeterCount: number;
  /** 已接入回路逐小时同时刻加总峰值 kW */
  peakKw: number;
  /** 全天(24h)平均功率 kW */
  avgKw: number;
  /** 峰值负载率 % (kW/kVA, 未计无功) */
  peakLoadPct: number;
  /** 平均负载率 % */
  avgLoadPct: number;
  /** PF0.9 折算峰值负载率 % */
  peakLoadPctPf: number;
  /** PF0.9 折算平均负载率 % */
  avgLoadPctPf: number;
  /** 24 点加总曲线 (仅 calc 模式给) */
  curve: Em123LoadPoint[];
  /** 右侧状态文案 (calc 为动态「峰x% · 均x%」, 其余为静态) */
  statusText: string;
  note: string;
}

/** 变压器监测面板汇总 (真实台账 + 分级负载率)。 */
export interface Em123TransformerSummary {
  totalCount: number;
  totalCapacityKva: number;
  activeCount: number;
  activeCapacityKva: number;
  /** 已上云三相回路表数 (12) */
  cloudMeters: number;
  /** 贝林三相表总数 (27) */
  threePhaseTotal: number;
  transformers: Em123TransformerView[];
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
  /** 变压器监测 (9 台台账 + 分级负载率; 无则 null) */
  transformers: Em123TransformerSummary | null;
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
    transformers: null,
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
    @InjectRepository(Em123WriteLog) private readonly writeLogRepo: Repository<Em123WriteLog>,
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
      const transformers = buildTransformerSummary(load.meters);
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
        transformers,
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

  // ==================== 一期: PWA 能源管理后台 (只读) ====================

  /** 已启用并具备平台客户端, 否则抛错。 */
  private ensureClient(): Em123Client {
    if (!this.cfg.enabled || !this.client) {
      throw new Error('em123 平台未启用或未配置账号, 暂不可查询');
    }
    return this.client;
  }

  /**
   * 欠费/透支明细 (由已落库表档案派生, 不额外请求平台)。
   * 两个口径分开, 避免误读:
   *   - household: 分户表余额<0 的欠费户数与金额 (电 28 / 水 8, 共 36 户);
   *   - master:    关口总表(三相)负余额透支, 覆盖公区/商业/大棚等未装分户表负荷,
   *                金额可能很大(电费负余额主要集中在关口总表), 不属于"欠费户"。
   */
  async getArrears(type: 'E' | 'W') {
    const tree = await this.getTree(type);
    const meters: Em123MeterView[] = [];
    tree?.groups.forEach((g) => g.meters.forEach((m) => meters.push(m)));
    const household = meters.filter((m) => m.kind === 'household' && m.money < 0);
    const master = meters.filter((m) => m.kind === 'master' && m.money < 0);
    const sum = (arr: Em123MeterView[]) =>
      round2(arr.reduce((s, m) => s + m.money, 0));
    return {
      type,
      household: { count: household.length, amount: sum(household), list: household },
      master: { count: master.length, amount: sum(master), list: master },
    };
  }

  /** 把扁平查询参数转成平台表单参数 (时间范围映射为若依 params[beginTime]/[endTime])。 */
  private buildListParams(q: Record<string, string>): Record<string, string | number> {
    const pageNum = Math.max(1, Math.min(Number(q.pageNum) || 1, 10_000));
    const pageSize = Math.max(1, Math.min(Number(q.pageSize) || 20, 200));
    const p: Record<string, string | number> = { pageNum, pageSize };
    const directKeys = [
      'meterNo',
      'meterType',
      'houseName',
      'meterId',
      'chargeMode',
      'chargeWay',
      'chargeStatus',
      'status',
      'controlType',
      'controlCode',
      'controlName',
      'controlStatus',
      'operateType',
      'orderByColumn',
      'isAsc',
    ];
    for (const k of directKeys) {
      const v = q[k];
      if (v !== undefined && v !== null && String(v).trim() !== '') p[k] = String(v).trim();
    }
    if (q.beginTime) p['params[beginTime]'] = q.beginTime;
    if (q.endTime) p['params[endTime]'] = q.endTime;
    return p;
  }

  /** 缴费流水分页 (实时代理 /record/charge/list)。 */
  async listCharges(q: Record<string, string>): Promise<{
    rows: Em123RawRow[];
    total: number;
    code?: number;
    msg?: string;
  }> {
    const client = this.ensureClient();
    const j = await client.fetchCharges(this.buildListParams(q));
    return { rows: j.rows ?? [], total: Number(j.total ?? j.rows?.length ?? 0), code: j.code, msg: j.msg };
  }

  /** 控制记录分页 (实时代理 /record/control/list)。 */
  async listControlRecords(q: Record<string, string>): Promise<{
    rows: Em123RawRow[];
    total: number;
    code?: number;
    msg?: string;
  }> {
    const client = this.ensureClient();
    const j = await client.fetchControlRecords(this.buildListParams(q));
    return { rows: j.rows ?? [], total: Number(j.total ?? j.rows?.length ?? 0), code: j.code, msg: j.msg };
  }

  /**
   * 只读召测 (仅触发一次抄表, 不改开关/状态)。
   * 前端视图以 meterNo 为键, 平台召测接口用 meterId; 先实时查一次档案解析 meterId。
   */
  async requestReadout(meterNo: string, type: 'E' | 'W'): Promise<{ code?: number; msg?: string }> {
    const client = this.ensureClient();
    const no = String(meterNo ?? '').trim();
    if (!no) throw new Error('meterNo 不能为空');
    const rows = await client.fetchMeters(type);
    const hit = rows.find((r) => String(r.meterNo ?? '').trim() === no);
    const meterId = hit?.meterId;
    if (meterId === undefined || meterId === null || meterId === '') {
      throw new Error(`未在平台找到${type === 'W' ? '水' : '电'}表 ${no}, 无法召测`);
    }
    return client.requestReadout(String(meterId));
  }

  /**
   * 一键导出真实 xlsx (平台两步代理)。
   * @param kind meter=表档案 / charge=缴费流水 / usage=用量报表
   */
  async exportXlsx(
    kind: 'meter' | 'charge' | 'usage',
    q: Record<string, string>,
  ): Promise<Em123ExportFile> {
    const client = this.ensureClient();
    const p: Record<string, string | number> = {};
    if (q.beginTime) p['params[beginTime]'] = q.beginTime;
    if (q.endTime) p['params[endTime]'] = q.endTime;
    let path: string;
    if (kind === 'meter') {
      path = '/basic/meter/export';
      p.meterType = q.meterType === 'W' ? 'W' : 'E';
    } else if (kind === 'charge') {
      path = '/record/charge/export';
      if (q.chargeMode) p.chargeMode = q.chargeMode;
      if (q.chargeWay) p.chargeWay = q.chargeWay;
    } else {
      // 用量报表导出平台侧强制要求时间范围(无参直接返回 500), 且逐表汇总较慢
      // (实测近 30 天约 43s); 未传时间窗时默认近 30 天, 保证端点健壮可用。
      path = '/report/record/usage/export';
      if (q.meterType) p.meterType = q.meterType === 'W' ? 'W' : 'E';
      if (!q.beginTime) {
        const begin = new Date();
        begin.setDate(begin.getDate() - 29);
        p['params[beginTime]'] = localDateStr(begin);
      }
      if (!q.endTime) p['params[endTime]'] = localDateStr();
    }
    return client.exportFile(path, p);
  }

  // ===========================================================================
  // 二/三期: 写操作 (改名 / 档案 / 现金补量 / 退费 / 减免 / 远程控制)
  // 统一铁律: 先只读回显拿完整行 -> 后端参数校验 -> 只发一次 -> 无论成败都留痕
  // (操作人/前后值/原因) -> 写后异步刷新只读缓存。
  // ===========================================================================

  /** 写操作留痕 (成功/失败/未确认都落 em123_write_log; 留痕失败不影响主流程)。 */
  private async recordWrite(
    opts: {
      bizType: Em123WriteBizType;
      actor: Actor;
      meterType?: 'E' | 'W' | null;
      meterNo?: string | null;
      meterId?: unknown;
      houseId?: unknown;
      houseName?: string | null;
      userName?: string | null;
      amount?: number | null;
      beforeBalance?: number | null;
      afterBalance?: number | null;
      reason?: string | null;
      payloadBefore?: Record<string, unknown> | null;
      payloadAfter?: Record<string, unknown> | null;
      result?: Em123WriteResult | null;
      status?: Em123WriteStatus;
      platformCode?: number | null;
      platformMsg?: string | null;
    },
  ): Promise<Em123WriteLog | null> {
    const { actor, result } = opts;
    const log = this.writeLogRepo.create({
      bizType: opts.bizType,
      meterType: opts.meterType ?? null,
      meterNo: opts.meterNo ?? null,
      meterId: opts.meterId != null ? String(opts.meterId) : null,
      houseId: opts.houseId != null ? String(opts.houseId) : null,
      houseName: opts.houseName ?? null,
      userName: opts.userName ?? null,
      amount: opts.amount ?? 0,
      beforeBalance: opts.beforeBalance ?? null,
      afterBalance: opts.afterBalance ?? null,
      reason: opts.reason ?? null,
      payloadBefore: opts.payloadBefore ? JSON.stringify(opts.payloadBefore) : null,
      payloadAfter: opts.payloadAfter ? JSON.stringify(opts.payloadAfter) : null,
      status: opts.status ?? (result?.ok ? 'success' : 'failed'),
      platformCode: opts.platformCode ?? result?.code ?? null,
      platformMsg: opts.platformMsg ?? result?.msg ?? null,
      operatorId: actor.userId,
      operatorName: actor.username,
      operatorRole: actor.role,
    });
    try {
      return await this.writeLogRepo.save(log);
    } catch (e) {
      this.logger.error(`em123 写操作留痕失败: ${(e as Error).message}`);
      return null;
    }
  }

  /** 写后异步刷新表档案/余额缓存 (不阻塞返回)。 */
  private refreshAfterWrite(): void {
    setTimeout(() => {
      void this.syncMeters().catch((e) => this.logger.warn(`写后刷新表档案失败: ${(e as Error).message}`));
    }, 1500);
  }

  /** 住房（客户名）实时列表 (改名前回显/搜索), keyword 模糊匹配名称。 */
  async listHouses(keyword?: string, limit = 100): Promise<Em123RawRow[]> {
    const client = this.ensureClient();
    const houses = await client.fetchHouses();
    const kw = String(keyword ?? '').trim();
    let out = houses;
    if (kw) {
      out = houses.filter((h) =>
        String(h.houseName ?? '').includes(kw) || String(h.fullName ?? '').includes(kw));
    }
    return out.slice(0, Math.min(500, Math.max(1, limit)));
  }

  /** 业主（户名）实时列表 (改名前回显/搜索), 透传平台分页。 */
  async listUsers(q: Record<string, string>): Promise<{ rows: Em123RawRow[]; total: number }> {
    const client = this.ensureClient();
    const j = await client.fetchUsers(this.buildListParams(q));
    return { rows: j.rows ?? [], total: Number(j.total ?? j.rows?.length ?? 0) };
  }

  /** 退费表单回显 (前端展示原充值金额与户名)。 */
  async getRefundForm(recordId: string | number) {
    const client = this.ensureClient();
    return client.fetchRefundForm(recordId);
  }

  /**
   * 按表号回显"改名/档案/收银"上下文: 表档案 + 关联住房 + 关联业主。
   * 前端下钻只持有 meterNo, 由后端实时回显 houseId/userId/余额/倍率/价格等。
   */
  async getMeterContext(type: 'E' | 'W', meterNo: string) {
    const client = this.ensureClient();
    const meter = await this.findMeterRow(type, meterNo);
    let house: Em123RawRow | null = null;
    let user: Em123RawRow | null = null;
    if (meter.houseId != null && meter.houseId !== '') {
      try {
        house = await this.findHouseRow(String(meter.houseId));
      } catch { /* 个别表可能未绑定住房 */ }
    }
    if (meter.userId != null) {
      try {
        const uj = await client.fetchUsers({ pageNum: 1, pageSize: 500 });
        user = (uj.rows ?? []).find((x) => String(x.userId) === String(meter.userId)) ?? null;
      } catch { /* 户名可缺失 */ }
    }
    return {
      meterType: type,
      meter: {
        meterId: meter.meterId, meterNo: meter.meterNo, meterType: meter.meterType,
        houseId: meter.houseId, houseName: meter.houseName, userId: meter.userId,
        deptId: meter.deptId,
        multiply: meter.multiply, priceId: meter.priceId, priceName: meter.priceName,
        meterModel: meter.modelName, modelName: meter.modelName,
        chargeMoney: meter.chargeMoney, meterFlag: meter.meterFlag,
        connType: meter.connType, deviceImei: meter.deviceImei,
        alarmId: meter.alarmId, alarmName: meter.alarmName, remark: meter.remark,
      },
      house: house ? {
        houseId: house.houseId, houseName: house.houseName, fullName: house.fullName,
        deptId: house.deptId, parentId: house.parentId, remark: house.remark,
      } : null,
      user: user ? {
        userId: user.userId, userName: user.userName, userPhone: user.userPhone,
        userNumber: user.userNumber, houseIds: user.houseIds, houseId: user.houseId,
        houseName: user.houseName, remark: user.remark,
      } : null,
    };
  }

  /** 实时定位某块表的完整平台行 (写前回显)。 */
  private async findMeterRow(type: 'E' | 'W', meterNo: string): Promise<Em123RawRow> {
    const client = this.ensureClient();
    const no = String(meterNo ?? '').trim();
    if (!no) throw new BadRequestException('meterNo 不能为空');
    const rows = await client.fetchMeters(type);
    const hit = rows.find((r) => String(r.meterNo ?? '').trim() === no);
    if (!hit) throw new BadRequestException(`未在平台找到${type === 'W' ? '水' : '电'}表 ${no}`);
    return hit;
  }

  /** 实时定位某条住房的完整平台行 (写前回显)。 */
  private async findHouseRow(houseId: string | number): Promise<Em123RawRow> {
    const client = this.ensureClient();
    const houses = await client.fetchHouses();
    const hit = houses.find((h) => String(h.houseId) === String(houseId));
    if (!hit) throw new BadRequestException(`未在平台找到住房 ${houseId}`);
    return hit;
  }

  /** 实时定位某个业主的完整平台行 (写前回显)。 */
  private async findUserRow(userId: string | number): Promise<Em123RawRow> {
    const client = this.ensureClient();
    const j = await client.fetchUsers({ pageNum: 1, pageSize: 500 });
    const hit = (j.rows ?? []).find((u) => String(u.userId) === String(userId));
    if (!hit) throw new BadRequestException(`未在平台找到业主 ${userId}`);
    return hit;
  }

  /** 住房（客户名）改名: 回显完整行, 仅改名称/上级/备注, 保留其余字段。 */
  async renameHouse(
    input: {
      houseId: string | number;
      houseName?: string;
      fullName?: string;
      parentId?: string | number;
      remark?: string;
      actor: Actor;
    },
  ): Promise<Em123WriteResult> {
    const client = this.ensureClient();
    const before = await this.findHouseRow(input.houseId);
    const newName = String(input.houseName ?? '').trim();
    if (!newName) throw new BadRequestException('住房名称不能为空');
    const payload: Record<string, string | number> = {
      houseId: before.houseId as number,
      houseName: newName,
      fullName: input.fullName != null ? String(input.fullName) : String(before.fullName ?? newName),
      parentId: (input.parentId != null ? input.parentId : before.parentId) as number,
      ancestors: String(before.ancestors ?? '0'),
      orderNum: (before.orderNum as number) ?? 0,
      houseType: String(before.houseType ?? 'h'),
      deptId: before.deptId as number,
      remark: input.remark != null ? String(input.remark) : String(before.remark ?? ''),
    };
    let result: Em123WriteResult;
    try {
      result = await client.saveHouse(payload);
    } catch (e) {
      await this.recordWrite({
        bizType: 'house_rename', actor: input.actor, houseId: before.houseId,
        houseName: before.houseName as string, reason: input.remark ?? null,
        payloadBefore: before, payloadAfter: payload,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: 'house_rename', actor: input.actor, houseId: before.houseId,
      houseName: before.houseName as string,
      reason: input.remark ?? null,
      payloadBefore: { houseName: before.houseName, fullName: before.fullName },
      payloadAfter: { houseName: payload.houseName, fullName: payload.fullName },
      result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /** 业主（户名）改名 / 改电话: 回显完整行, 保留绑定关系与其余字段。 */
  async renameUser(
    input: {
      userId: string | number;
      userName?: string;
      userPhone?: string;
      remark?: string;
      actor: Actor;
    },
  ): Promise<Em123WriteResult> {
    const client = this.ensureClient();
    const before = await this.findUserRow(input.userId);
    const newName = String(input.userName ?? '').trim();
    if (!newName) throw new BadRequestException('业主户名不能为空');
    const payload: Record<string, string | number> = {
      userId: before.userId as number,
      userName: newName,
      userPhone: input.userPhone != null ? String(input.userPhone) : String(before.userPhone ?? ''),
      userNumber: String(before.userNumber ?? ''),
      deptId: before.deptId as number,
      houseIds: String(before.houseIds ?? ''),
      houseId: String(before.houseId ?? ''),
      houseName: String(before.houseName ?? ''),
      remark: input.remark != null ? String(input.remark) : String(before.remark ?? ''),
    };
    let result: Em123WriteResult;
    try {
      result = await client.saveUser(payload);
    } catch (e) {
      await this.recordWrite({
        bizType: 'user_rename', actor: input.actor,
        userName: before.userName as string, reason: input.remark ?? null,
        payloadBefore: before, payloadAfter: payload,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: 'user_rename', actor: input.actor,
      userName: before.userName as string, reason: input.remark ?? null,
      payloadBefore: { userName: before.userName, userPhone: before.userPhone },
      payloadAfter: { userName: payload.userName, userPhone: payload.userPhone },
      result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /** 电表/水表档案维护: 回显完整行, 仅更新显式提交字段 (倍率/价格/型号/备注/绑定)。 */
  async editMeter(
    input: {
      meterType: 'E' | 'W';
      meterNo: string;
      fields: Record<string, string | number>;
      actor: Actor;
    },
  ): Promise<Em123WriteResult> {
    const client = this.ensureClient();
    const before = await this.findMeterRow(input.meterType, input.meterNo);
    const allowed = ['meterModel', 'modelName', 'multiply', 'priceId', 'alarmId', 'houseId', 'remark', 'serialNo'];
    const patch: Record<string, string | number> = {
      meterId: before.meterId as number,
      meterNo: before.meterNo as string,
      meterType: before.meterType as string,
      connType: String(before.connType ?? '4G'),
      deviceImei: String(before.deviceImei ?? ''),
      deptId: before.deptId as number,
    };
    for (const k of allowed) {
      if (input.fields[k] !== undefined) patch[k] = input.fields[k];
      else if (before[k] !== undefined && before[k] !== null) patch[k] = before[k] as string | number;
    }
    let result: Em123WriteResult;
    try {
      result = await client.saveMeter(patch);
    } catch (e) {
      await this.recordWrite({
        bizType: 'meter_edit', actor: input.actor, meterType: input.meterType,
        meterNo: input.meterNo, meterId: before.meterId, houseName: before.houseName as string,
        payloadBefore: before, payloadAfter: patch,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: 'meter_edit', actor: input.actor, meterType: input.meterType,
      meterNo: input.meterNo, meterId: before.meterId, houseName: before.houseName as string,
      payloadBefore: before, payloadAfter: patch, result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /**
   * 现金 / 补量录入 (chargeMode=cash 现金支付 / replienish 补量)。
   * 资金高危: 后端硬校验金额上限 + 大额二次确认; 先回显当前余额, 完整表单只发一次。
   * 不做 wxpay 在线支付 (微信缴费由业主自助走汇付, PWA 不代收)。
   */
  async cashCharge(input: {
    meterType: 'E' | 'W';
    meterNo: string;
    mode: 'cash' | 'replienish';
    amount: number;
    remark?: string;
    /** 大额二次确认标记 (前端二次确认后传 true)。 */
    confirm?: boolean;
    actor: Actor;
  }): Promise<Em123WriteResult & { beforeBalance?: number; afterBalance?: number }> {
    const client = this.ensureClient();
    const mode = input.mode === 'replienish' ? 'replienish' : 'cash';
    const amount = Number(input.amount);
    const chargeErr = validateChargeAmount({
      amount,
      limit: this.cfg.cashChargeLimit,
      threshold: this.cfg.largeAmountThreshold,
      confirm: !!input.confirm,
      mode,
    });
    if (chargeErr) throw new BadRequestException(chargeErr);
    const meter = await this.findMeterRow(input.meterType, input.meterNo);
    // 业主户名: 平台表单选择表时带出; 尽量回显匹配, 查不到则留空(平台可接受)。
    let userName = '';
    if (meter.userId != null) {
      try {
        const uj = await client.fetchUsers({ pageNum: 1, pageSize: 500 });
        const u = (uj.rows ?? []).find((x) => String(x.userId) === String(meter.userId));
        userName = u ? String(u.userName ?? '') : '';
      } catch { /* 户名非必填, 忽略 */ }
    }
    const beforeBalance = num(meter.chargeMoney);
    const afterBalance = round2(beforeBalance + amount);
    const payload: Record<string, string | number> = {
      deptId: meter.deptId as number,
      houseId: meter.houseId as number,
      meterId: meter.meterId as number,
      meterNo: meter.meterNo as string,
      userId: meter.userId != null ? (meter.userId as number) : '',
      userName,
      oldMoney: beforeBalance,
      chargeMoney: amount,
      newMoney: afterBalance,
      chargeMode: mode,
      remark: String(input.remark ?? ''),
    };
    let result: Em123WriteResult;
    try {
      result = await client.cashCharge(payload);
    } catch (e) {
      await this.recordWrite({
        bizType: mode === 'replienish' ? 'charge_supplement' : 'charge_cash',
        actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
        meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
        userName: userName || null, amount, beforeBalance, afterBalance,
        reason: input.remark ?? null, payloadBefore: { chargeMoney: beforeBalance }, payloadAfter: payload,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: mode === 'replienish' ? 'charge_supplement' : 'charge_cash',
      actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
      meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
      userName: userName || null, amount, beforeBalance, afterBalance,
      reason: input.remark ?? null,
      payloadBefore: { chargeMoney: beforeBalance },
      payloadAfter: { chargeMode: mode, chargeMoney: amount, newMoney: afterBalance },
      result,
    });
    if (result.ok) this.refreshAfterWrite();
    return { ...result, beforeBalance, afterBalance };
  }

  /**
   * 退费: 必须先回显系统生成的退费表单 (refundNo/seleNo 等), 退费金额不得超过原充值额。
   * 现金单 (chargeWay=pc, 无交易号) 只能现金退费 refundMode=1; 原路退回仅微信在线单。
   */
  async refund(input: {
    recordId: string | number;
    refundMoney: number;
    refundMode?: '0' | '1';
    remark?: string;
    confirm?: boolean;
    actor: Actor;
  }): Promise<Em123WriteResult> {
    const client = this.ensureClient();
    const form = await client.fetchRefundForm(input.recordId);
    const refundMoney = Number(input.refundMoney);
    const refundErr = validateRefundAmount({
      money: refundMoney,
      original: form.chargeMoney === null ? null : round2(form.chargeMoney),
      threshold: this.cfg.largeAmountThreshold,
      confirm: !!input.confirm,
    });
    if (refundErr) throw new BadRequestException(refundErr);
    // 现金单无交易号, 强制现金退费
    const hasTradeNo = Boolean(form.hidden.tradeNo || form.hidden.saleTradeNo);
    const refundMode = !hasTradeNo ? '1' : input.refundMode === '0' ? '0' : '1';
    const payload: Record<string, string | number> = {
      ...Object.fromEntries(Object.entries(form.hidden).map(([k, v]) => [k, String(v ?? '')])),
      houseName: form.houseName ?? '',
      meterNo: form.meterNo ?? '',
      userName: form.userName ?? '',
      chargeMoney: form.chargeMoney ?? '',
      refundMoney,
      refundMode,
      remark: String(input.remark ?? ''),
    };
    let result: Em123WriteResult;
    try {
      result = await client.refund(form.recordId, payload);
    } catch (e) {
      await this.recordWrite({
        bizType: 'refund', actor: input.actor, meterId: form.meterId,
        houseId: form.houseId, houseName: form.houseName, userName: form.userName,
        amount: refundMoney, beforeBalance: form.chargeMoney,
        reason: input.remark ?? null, payloadBefore: { chargeMoney: form.chargeMoney }, payloadAfter: payload,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: 'refund', actor: input.actor, meterId: form.meterId,
      houseId: form.houseId, houseName: form.houseName, userName: form.userName,
      amount: refundMoney, beforeBalance: form.chargeMoney,
      reason: input.remark ?? null,
      payloadBefore: { chargeMoney: form.chargeMoney },
      payloadAfter: { refundMoney, refundMode },
      result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /**
   * 减免: 平台按"住房树多选 + 表类型"核销应收。从单表进入时把 houseIds 收敛为该表所属住房。
   * 金额必须为正、达大额门槛二次确认, 全量留痕 (权限点 energy:refund)。
   */
  async reduction(input: {
    meterType: 'E' | 'W';
    meterNo: string;
    reductionMoney: number;
    reason?: string;
    confirm?: boolean;
    actor: Actor;
  }): Promise<Em123WriteResult> {
    const client = this.ensureClient();
    const ctx = await this.getMeterContext(input.meterType, input.meterNo);
    const meter = ctx.meter;
    const reductionMoney = round2(Number(input.reductionMoney));
    const reductionErr = validateReductionAmount({
      money: reductionMoney,
      threshold: this.cfg.largeAmountThreshold,
      confirm: !!input.confirm,
    });
    if (reductionErr) throw new BadRequestException(reductionErr);
    if (meter.houseId == null || String(meter.houseId) === '') {
      throw new BadRequestException('该表未绑定住房，无法按住房减免');
    }
    const house = ctx.house;
    const payload: Record<string, string | number> = {
      deptId: String(meter.deptId ?? house?.deptId ?? ''),
      houseIds: String(meter.houseId),
      meterType: input.meterType,
      reductionMoney,
      remark: String(input.reason ?? ''),
    };
    const base = {
      actor: input.actor,
      meterType: input.meterType,
      meterNo: String(meter.meterNo ?? input.meterNo),
      meterId: String(meter.meterId ?? ''),
      houseId: String(meter.houseId),
      houseName: String(house?.houseName ?? meter.houseName ?? ''),
      userName: ctx.user?.userName != null ? String(ctx.user.userName) : null,
      amount: reductionMoney,
      reason: input.reason ?? null,
      payloadBefore: { chargeMoney: Number(meter.chargeMoney ?? 0) },
    };
    let result: Em123WriteResult;
    try {
      result = await client.reduction(payload);
    } catch (e) {
      await this.recordWrite({
        ...base, bizType: 'reduction',
        payloadAfter: payload, status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      ...base, bizType: 'reduction',
      payloadAfter: { reductionMoney }, result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /**
   * 远程控制 (拉闸/合闸/校时/多费率), 高危:
   * 仅 admin (权限点 energy:control 不授任何角色, 守卫层已挡, 这里再硬校验);
   * 拉合闸必须填原因 + 输入户名/住房名强二次确认; 全量留痕。
   */
  async remoteControl(input: {
    action: 'wattoff' | 'watton' | 'settime' | 'setrate';
    meterType: 'E' | 'W';
    meterNo: string;
    reason?: string;
    /** 拉合闸强二次确认: 必须输入与该表一致的住房名/户名。 */
    confirmName?: string;
    actor: Actor;
  }): Promise<Em123WriteResult> {
    if (!canRemoteControl(input.actor.role)) {
      throw new ForbiddenException('远程断电/送电仅管理员可操作');
    }
    const client = this.ensureClient();
    const action = input.action;
    const meter = await this.findMeterRow(input.meterType, input.meterNo);
    const expectName = String(meter.houseName ?? '').trim();
    const controlErr = validateSwitchControl({
      action,
      reason: String(input.reason ?? ''),
      confirmName: String(input.confirmName ?? ''),
      expectName,
    });
    if (controlErr) throw new BadRequestException(controlErr);
    const payload: Record<string, string | number> = { meterIds: String(meter.meterId) };
    let result: Em123WriteResult;
    const bizType: Em123WriteBizType =
      action === 'wattoff' ? 'control_off'
      : action === 'watton' ? 'control_on'
      : action === 'settime' ? 'settime' : 'setrate';
    try {
      result = await client.remoteControl(action, payload);
    } catch (e) {
      await this.recordWrite({
        bizType, actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
        meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
        reason: input.reason ?? null, payloadBefore: { meterFlag: meter.meterFlag }, payloadAfter: payload,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType, actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
      meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
      reason: input.reason ?? null,
      payloadBefore: { meterFlag: meter.meterFlag },
      payloadAfter: { action, meterIds: payload.meterIds },
      result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /** 多费率设置回显：定位表，取平台费率方案(rateId)下拉。 */
  async getSetRateForm(meterType: 'E' | 'W', meterNo: string): Promise<{
    meterId: string;
    meterNo: string;
    houseName: string;
    currentPriceName: string | null;
    rateOptions: { value: string; label: string }[];
  }> {
    const client = this.ensureClient();
    const meter = await this.findMeterRow(meterType, meterNo);
    const form = await client.fetchSetRateForm(String(meter.meterId));
    return {
      meterId: String(meter.meterId),
      meterNo: String(meter.meterNo ?? meterNo),
      houseName: String(meter.houseName ?? ''),
      currentPriceName: meter.priceName != null ? String(meter.priceName) : null,
      rateOptions: form.rateOptions,
    };
  }

  /**
   * 多费率设置下发 (仅 admin): 把表绑定到指定费率方案(rateId)。
   * 改计费属高危，须选有效方案 + 强二次确认(逐字输入住房名 + 原因)，全量留痕。
   */
  async setRate(input: {
    meterType: 'E' | 'W';
    meterNo: string;
    rateId?: string;
    reason?: string;
    confirmName?: string;
    actor: Actor;
  }): Promise<Em123WriteResult> {
    if (!canRemoteControl(input.actor.role)) {
      throw new ForbiddenException('多费率设置仅管理员可操作');
    }
    const client = this.ensureClient();
    const meter = await this.findMeterRow(input.meterType, input.meterNo);
    const expectName = String(meter.houseName ?? '').trim();
    const form = await client.fetchSetRateForm(String(meter.meterId));
    const rateId = String(input.rateId ?? '').trim();
    if (!rateId || !form.rateOptions.some((o) => o.value === rateId)) {
      throw new BadRequestException('请选择有效的费率方案');
    }
    const confirmErr = validateNamedConfirm({
      reason: String(input.reason ?? ''),
      confirmName: String(input.confirmName ?? ''),
      expectName,
      verb: '多费率设置',
    });
    if (confirmErr) throw new BadRequestException(confirmErr);
    const rateLabel = form.rateOptions.find((o) => o.value === rateId)?.label ?? rateId;
    const payload: Record<string, string | number> = { meterIds: form.meterIds, rateId };
    const before = { priceId: String(meter.priceId ?? ''), priceName: String(meter.priceName ?? '') };
    const after = { ...payload, rateLabel };
    let result: Em123WriteResult;
    try {
      result = await client.remoteControl('setrate', payload);
    } catch (e) {
      await this.recordWrite({
        bizType: 'setrate', actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
        meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
        reason: input.reason ?? null, payloadBefore: before, payloadAfter: after,
        status: 'failed', platformMsg: (e as Error).message,
      });
      throw e;
    }
    await this.recordWrite({
      bizType: 'setrate', actor: input.actor, meterType: input.meterType, meterNo: input.meterNo,
      meterId: meter.meterId, houseId: meter.houseId, houseName: meter.houseName as string,
      reason: input.reason ?? null, payloadBefore: before, payloadAfter: after, result,
    });
    if (result.ok) this.refreshAfterWrite();
    return result;
  }

  /** 写操作对账清单分页 (操作留痕)。 */
  async listWriteLogs(q: {
    pageNum?: string;
    pageSize?: string;
    bizType?: string;
    meterNo?: string;
    operator?: string;
    startDate?: string;
    endDate?: string;
  }): Promise<{ rows: Em123WriteLog[]; total: number }> {
    const pageNum = Math.max(1, Number(q.pageNum ?? 1) || 1);
    const pageSize = Math.min(200, Math.max(1, Number(q.pageSize ?? 20) || 20));
    const qb = this.writeLogRepo.createQueryBuilder('w');
    if (q.bizType) qb.andWhere('w.bizType = :bt', { bt: q.bizType });
    if (q.meterNo) qb.andWhere('w.meterNo LIKE :mn', { mn: `%${q.meterNo}%` });
    if (q.operator) qb.andWhere('(w.operatorName LIKE :op OR w.houseName LIKE :op)', { op: `%${q.operator}%` });
    if (q.startDate) qb.andWhere('w.createdAt >= :sd', { sd: `${q.startDate} 00:00:00` });
    if (q.endDate) qb.andWhere('w.createdAt <= :ed', { ed: `${q.endDate} 23:59:59` });
    qb.orderBy('w.id', 'DESC').skip((pageNum - 1) * pageSize).take(pageSize);
    const [rows, total] = await qb.getManyAndCount();
    return { rows, total };
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
    // 欠费判定统一以展示口径（余额保留 1 位小数后）为准，避免 -0.04 元这类
    // 微负余额在逐表徽标显示"欠费"、而余额却显示 0.00 的自相矛盾。
    const money = round1(m.chargeMoney);
    const isArrears = isHousehold && money < 0;
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
      money,
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

/**
 * 纯函数: 由变压器台账 + 各关口总表负荷视图, 构建变压器监测面板。
 * 每台变压器把下挂三相表的 24 点曲线按"滚动窗口同位置"(各表均为整点时刻)
 * 逐小时同时刻加总 → 峰值/平均功率与负载率 (kW/kVA, 另给 PF0.9 参考)。
 * 仅 mode=calc 给曲线与百分比; partial/none/off 只标注接入状态, 不把
 * 已接入回路的下限加总当整体负载率, 避免误导。
 */
export function buildTransformerSummary(
  loadMeters: Em123LoadMeter[],
): Em123TransformerSummary {
  const byNo = new Map<string, Em123LoadMeter>(loadMeters.map((m) => [m.meterNo, m]));

  const transformers: Em123TransformerView[] = TRANSFORMERS.map((p) => {
    const linked = p.meterNos
      .map((no) => byNo.get(no))
      .filter((m): m is Em123LoadMeter => Boolean(m));
    const onlineMeterCount = linked.filter((m) => m.online).length;

    // 逐小时同时刻加总 (各表均为滚动 24h 整点窗口, 按位置对齐)
    const kwArr = new Array<number>(LOAD_CURVE_POINTS).fill(0);
    for (const m of linked) {
      m.curve.forEach((pt, i) => {
        if (i < LOAD_CURVE_POINTS) kwArr[i] += pt.kw;
      });
    }
    const peakKw = round1(kwArr.length ? Math.max(...kwArr) : 0);
    const avgKw = round1(kwArr.reduce((s, v) => s + v, 0) / LOAD_CURVE_POINTS);
    const denom = p.capacityKva > 0 ? p.capacityKva : 1;
    const peakLoadPct = round1((peakKw / denom) * 100);
    const avgLoadPct = round1((avgKw / denom) * 100);
    const peakLoadPctPf = round1(peakLoadPct / ASSUMED_POWER_FACTOR);
    const avgLoadPctPf = round1(avgLoadPct / ASSUMED_POWER_FACTOR);

    // 曲线时刻取任一在线表的对应点
    const curve: Em123LoadPoint[] =
      p.mode === 'calc'
        ? kwArr.map((kw, i) => {
            const ref = linked.find((m) => m.curve[i]);
            return {
              hour: ref?.curve[i]?.hour ?? i,
              kw: round1(kw),
              time: ref?.curve[i]?.time ?? '',
            };
          })
        : [];

    const statusText =
      p.mode === 'calc'
        ? `峰${Math.round(peakLoadPct)}% · 均${Math.round(avgLoadPct)}%`
        : p.statusText;

    return {
      id: p.id,
      capacityKva: p.capacityKva,
      location: p.location,
      tfType: p.tfType,
      active: p.active,
      mode: p.mode,
      meterCount: p.meterNos.length,
      onlineMeterCount,
      peakKw,
      avgKw,
      peakLoadPct,
      avgLoadPct,
      peakLoadPctPf,
      avgLoadPctPf,
      curve,
      statusText,
      note: p.note,
    };
  });

  const active = TRANSFORMERS.filter((t) => t.active);
  return {
    totalCount: TRANSFORMERS.length,
    totalCapacityKva: TRANSFORMERS.reduce((s, t) => s + t.capacityKva, 0),
    activeCount: active.length,
    activeCapacityKva: active.reduce((s, t) => s + t.capacityKva, 0),
    cloudMeters: loadMeters.length,
    threePhaseTotal: THREE_PHASE_TOTAL,
    transformers,
  };
}
