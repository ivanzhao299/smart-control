import { Inject, Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { PowerSchedule, PowerScheduleMode } from '../../entities/power-schedule.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { PowerCircuitsService } from '../power-circuits/power-circuits.service';
import { calcSunTimes } from './sun-calc';

/** 园区默认坐标 (设备 GPS 实测均值, 2026-10-01 三台 4G 断路器上报: 35.0685°N, 118.1868°E) */
export const PARK_DEFAULT_LAT = 35.0685;
export const PARK_DEFAULT_LNG = 118.1868;
/** 中国时区 UTC+8 */
export const TZ_OFFSET_MIN = 480;

/** 偏移上下限: 日落/日出前后各 10 小时 (±600 分钟) */
export const OFFSET_MIN_LIMIT = 600;
/** 计算"下次触发"时向前/向后扫描的锚点日范围 (周多选最坏跳过 6 天, 14 天兜底) */
const LOOKAHEAD_DAYS = 14;

/** JS Date 的周日(0) → 规则口径 1=周一 .. 7=周日 */
function weekdayOf(date: Date): number {
  return (date.getDay() + 6) % 7 + 1;
}

/** 本地"某年/月/日 0 点"的 Date */
function dayDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day, 0, 0, 0, 0);
}

/**
 * 电源回路自动开关调度引擎 (定时 + 日落/日出)。
 *
 * 设计:
 *   - 规则存 power_schedules 表, 每回路可配多条 (开一条/关一条最常见)。
 *   - 每分钟扫描一次 enabled 规则; 命中(当前分钟 == 触发时刻)且"触发日"星期匹配 → 动作。
 *   - 日落/日出为"参考时点": 触发时刻 = 参考时点 + offsetMin (可前可后, ±600 分钟 = 10 小时),
 *     直接在绝对时间上相加, 因此跨午夜也能落到正确的日期与星期 (不做 mod 1440 折回)。
 *   - 经纬度: 回路 → hardware_unit.addressing.lat/lng (可配置); 缺省用园区 GPS 实测均值。
 *   - 动作走 PowerCircuitsService.turnOn/turnOff —— 复用已验证的适配器路由,
 *     失败记日志不重试 (下个周期自然会再试一次, 避免风暴)。
 */
@Injectable()
export class PowerSchedulesService implements OnModuleInit, OnModuleDestroy {
  private timer: NodeJS.Timeout | null = null;
  private lastMinuteKey = '';

  constructor(
    @InjectRepository(PowerSchedule) private readonly repo: Repository<PowerSchedule>,
    @InjectRepository(PowerCircuit) private readonly circuitRepo: Repository<PowerCircuit>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    private readonly circuits: PowerCircuitsService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshNextRuns();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref?.();
    this.logger.info('PowerSchedulesService 启动: 每分钟扫描定时/日落/日出自动开关', {
      context: 'PowerSchedulesService',
    });
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  // ============ 外部操作 (Controller 调用) ============

  async list(): Promise<PowerSchedule[]> {
    return this.repo.find({ order: { circuitId: 'ASC', id: 'ASC' } });
  }

  async listForCircuit(circuitId: number): Promise<PowerSchedule[]> {
    return this.repo.find({ where: { circuitId }, order: { id: 'ASC' } });
  }

  async create(dto: PowerScheduleInput): Promise<PowerSchedule> {
    this.assertValid(dto);
    const saved = await this.repo.save(this.repo.create({ ...dto, nextRunAt: null }));
    await this.refreshNextRuns();
    return saved;
  }

  async update(id: number, dto: Partial<PowerScheduleInput>): Promise<PowerSchedule> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error(`power schedule #${id} 不存在`);
    const merged = { ...row, ...dto };
    this.assertValid(merged);
    Object.assign(row, dto);
    const saved = await this.repo.save(row);
    await this.refreshNextRuns();
    return saved;
  }

  async remove(id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new Error(`power schedule #${id} 不存在`);
    await this.repo.remove(row);
  }

  /** 前端展示"下一次自动动作" (含日落/日出时刻 + 偏移计算) */
  async nextRun(circuitId: number): Promise<{ scheduleId: number; action: string; at: string } | null> {
    const rows = await this.repo.find({ where: { circuitId, enabled: true } });
    let best: { scheduleId: number; action: string; at: Date } | null = null;
    for (const r of rows) {
      const at = await this.calcNextDate(r);
      if (!at) continue;
      if (!best || at.getTime() < best.at.getTime()) best = { scheduleId: r.id, action: r.action, at };
    }
    return best ? { scheduleId: best.scheduleId, action: best.action, at: best.at.toISOString() } : null;
  }

  // ============ 调度核心 ============

  /** 每分钟 tick: 找当前分钟要动作的规则并执行 */
  private async tick(): Promise<void> {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()} ${now.getHours()}:${now.getMinutes()}`;
    if (key === this.lastMinuteKey) return;
    this.lastMinuteKey = key;

    // 当前分钟起点 (秒/毫秒清零), 用于精确匹配触发时刻
    const currentMinute = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), 0, 0);

    const rows = await this.repo.find({ where: { enabled: true } });
    // 触发时刻可能来自"今天锚点"或"昨天锚点"(昨天日落 + 大正偏移落到今天凌晨)
    const anchorOffsets = [0, -1];
    for (const r of rows) {
      for (const offset of anchorOffsets) {
        const anchorDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
        const t = await this.triggerDate(r, anchorDay);
        if (!t || t.getTime() !== currentMinute.getTime()) continue;
        if (!this.matchesWeekday(r, weekdayOf(t))) continue;
        await this.fire(r, t);
      }
    }
    await this.refreshNextRuns();
  }

  /**
   * 规则在某"锚点日"的触发绝对 Date。
   *   - fixed : 锚点日当天的 time 时刻。
   *   - sunset/sunrise: 该锚点日参考时点 + offsetMin (直接加, 允许落到相邻日)。
   * 极昼/极夜或无法计算 → null。
   */
  private async triggerDate(r: PowerSchedule, anchorDay: Date): Promise<Date | null> {
    if (r.mode === 'fixed') {
      if (!r.time) return null;
      const [h, m] = r.time.split(':').map((x) => parseInt(x, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return new Date(anchorDay.getFullYear(), anchorDay.getMonth(), anchorDay.getDate(), h, m, 0, 0);
    }
    const { lat, lng } = await this.resolveCoord(r.circuitId);
    const { sunriseMin, sunsetMin } = calcSunTimes(
      lat, lng, anchorDay.getFullYear(), anchorDay.getMonth() + 1, anchorDay.getDate(), TZ_OFFSET_MIN,
    );
    const baseMin = r.mode === 'sunset' ? sunsetMin : sunriseMin;
    if (baseMin === null) return null; // 极昼/极夜, 该锚点日无参考时点
    const anchor = new Date(
      anchorDay.getFullYear(), anchorDay.getMonth(), anchorDay.getDate(), 0, baseMin, 0, 0,
    );
    return new Date(anchor.getTime() + (r.offsetMin ?? 0) * 60_000);
  }

  /** 下一次触发日期时间 (找昨天锚点起、未来 LOOKAHEAD_DAYS 内第一个晚于现在的触发) */
  private async calcNextDate(r: PowerSchedule): Promise<Date | null> {
    const now = new Date();
    for (let d = -1; d <= LOOKAHEAD_DAYS; d += 1) {
      const anchorDay = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const t = await this.triggerDate(r, anchorDay);
      if (!t) continue;
      if (!this.matchesWeekday(r, weekdayOf(t))) continue;
      if (t.getTime() <= now.getTime()) continue;
      return t;
    }
    return null;
  }

  private matchesWeekday(r: PowerSchedule, weekday: number): boolean {
    if (!r.weekdays) return true;
    return r.weekdays.split(',').map((x) => parseInt(x, 10)).includes(weekday);
  }

  /** 经纬度: 回路 → gatewayCode → hardware_unit.addressing.lat/lng; 缺省园区 GPS 均值 */
  private coordCache = new Map<number, Promise<{ lat: number; lng: number }>>();
  private resolveCoord(circuitId: number): Promise<{ lat: number; lng: number }> {
    const cached = this.coordCache.get(circuitId);
    if (cached) return cached;
    const p = this.loadCoord(circuitId);
    this.coordCache.set(circuitId, p);
    return p;
  }

  private async loadCoord(circuitId: number): Promise<{ lat: number; lng: number }> {
    const defaults = { lat: PARK_DEFAULT_LAT, lng: PARK_DEFAULT_LNG };
    try {
      const circuit = await this.circuitRepo.findOne({ where: { id: circuitId } });
      if (!circuit?.gatewayCode) return defaults;
      const hw = await this.hwRepo.findOne({ where: { code: circuit.gatewayCode } });
      if (!hw?.addressing) return defaults;
      const addr = JSON.parse(hw.addressing) as { lat?: number; lng?: number };
      if (typeof addr.lat === 'number' && typeof addr.lng === 'number') {
        return { lat: addr.lat, lng: addr.lng };
      }
      return defaults;
    } catch {
      return defaults;
    }
  }

  /** 动作: 调电源回路服务 (走 4G/485/MQTT 适配器路由) */
  private async fire(r: PowerSchedule, at: Date): Promise<void> {
    try {
      if (r.action === 'on') await this.circuits.turnOn(r.circuitId);
      else await this.circuits.turnOff(r.circuitId);
      this.logger.info(
        `自动开关触发: circuit#${r.circuitId} ${r.action} (mode=${r.mode} at=${at.toISOString()})`,
        { context: 'PowerSchedulesService' },
      );
    } catch (err) {
      this.logger.warn(
        `自动开关失败: circuit#${r.circuitId} ${r.action} (mode=${r.mode}): ${(err as Error).message}`,
        { context: 'PowerSchedulesService' },
      );
    }
  }

  /** 全量刷新 next_run_at (日落跨日/规则变更/启动后调用) */
  async refreshNextRuns(): Promise<void> {
    const rows = await this.repo.find({ where: { enabled: true } });
    for (const r of rows) {
      const at = await this.calcNextDate(r);
      await this.repo.update(r.id, { nextRunAt: at });
    }
  }

  private assertValid(dto: PowerScheduleInput): void {
    if (!dto.circuitId) throw new Error('circuitId 必填');
    if (dto.action !== 'on' && dto.action !== 'off') throw new Error('action 只能是 on/off');
    if (!['fixed', 'sunset', 'sunrise'].includes(dto.mode)) throw new Error('mode 只能是 fixed/sunset/sunrise');
    if (dto.mode === 'fixed' && !dto.time) throw new Error('fixed 模式必须填 time');
    if (dto.mode === 'fixed' && dto.time && !/^\d{1,2}:\d{2}$/.test(dto.time)) throw new Error('time 格式应为 HH:mm');
    if (dto.offsetMin != null) {
      if (!Number.isInteger(dto.offsetMin)) throw new Error('偏移分钟必须是整数');
      if (dto.offsetMin < -OFFSET_MIN_LIMIT || dto.offsetMin > OFFSET_MIN_LIMIT) {
        throw new Error(`偏移范围为日落/日出前后 ${OFFSET_MIN_LIMIT} 分钟 (10 小时)`);
      }
    }
    if (dto.weekdays) {
      const parts = dto.weekdays.split(',');
      if (!parts.every((x) => /^[1-7]$/.test(x.trim()))) throw new Error('weekdays 只能是 1-7 逗号分隔');
    }
  }
}

export interface PowerScheduleInput {
  circuitId: number;
  action: 'on' | 'off';
  mode: PowerScheduleMode;
  time?: string | null;
  offsetMin?: number;
  weekdays?: string | null;
  enabled?: boolean;
}
