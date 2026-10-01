import { Inject, Injectable, Logger as NestLogger, OnModuleInit } from '@nestjs/common';
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

/**
 * 电源回路自动开关调度引擎 (定时 + 日落/日出)。
 *
 * 设计:
 *   - 规则存 power_schedules 表, 每回路可配多条 (开一条/关一条最常见)。
 *   - 每分钟扫描一次 enabled 规则; 命中(当前分钟 == 规则触发分钟)且星期匹配 → 动作。
 *   - 日落/日出时刻每天 0 点重算 (NOAA 算法按经纬度), 存在 nextRunAt 供前端展示。
 *   - 经纬度: 回路 → hardware_unit.addressing.lat/lng (可配置); 缺省用园区 GPS 实测均值。
 *   - 动作走 PowerCircuitsService.turnOn/turnOff —— 复用已验证的 4G 适配器路由,
 *     失败记日志不重试 (下个周期自然会再试一次, 但避免风暴)。
 */
@Injectable()
export class PowerSchedulesService implements OnModuleInit {
  /** 下一次触发的"具体日期时间"缓存: scheduleId -> Date (用于 nextRunAt 展示) */
  private nextCache = new Map<number, Date>();
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
    this.nextCache.delete(id);
  }

  /** 前端展示"下一次自动动作" (含日落/日出时刻计算) */
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

    // 每天 0 点重算日落/日出时刻
    if (now.getHours() === 0 && now.getMinutes() < 1) {
      await this.refreshNextRuns();
    }

    const todayMin = now.getHours() * 60 + now.getMinutes();
    const weekday = (now.getDay() + 6) % 7 + 1; // JS getDay(): 0=周日 → 1=周一..7=周日
    const rows = await this.repo.find({ where: { enabled: true } });
    for (const r of rows) {
      const triggerMin = await this.triggerMinute(r, now);
      if (triggerMin === null) continue;
      if (triggerMin !== todayMin) continue;
      if (!this.matchesWeekday(r, weekday)) continue;
      await this.fire(r, now);
    }
    // 更新 nextRunAt 展示缓存 (低频, 只在规则少时全刷)
    await this.refreshNextRuns();
  }

  /** 规则在"今天"的触发分钟 (0..1439); 不适用返回 null */
  private async triggerMinute(r: PowerSchedule, now: Date): Promise<number | null> {
    if (r.mode === 'fixed') {
      if (!r.time) return null;
      const [h, m] = r.time.split(':').map((x) => parseInt(x, 10));
      if (Number.isNaN(h) || Number.isNaN(m)) return null;
      return h * 60 + m;
    }
    if (r.mode === 'sunset' || r.mode === 'sunrise') {
      const { lat, lng } = await this.resolveCoord(r.circuitId);
      const { sunriseMin, sunsetMin } = calcSunTimes(
        lat, lng, now.getFullYear(), now.getMonth() + 1, now.getDate(), TZ_OFFSET_MIN,
      );
      const base = r.mode === 'sunset' ? sunsetMin : sunriseMin;
      if (base === null) return null; // 极昼/极夜, 当日无触发
      return ((base + r.offsetMin) % 1440 + 1440) % 1440;
    }
    return null;
  }

  /** 计算下一次触发日期时间 (用于 nextRunAt 展示; 找今天或未来 3 天内的第一个触发) */
  private async calcNextDate(r: PowerSchedule): Promise<Date | null> {
    const cached = this.nextCache.get(r.id);
    if (cached) return cached;
    const now = new Date();
    for (let d = 0; d < 4; d += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const weekday = (day.getDay() + 6) % 7 + 1;
      if (!this.matchesWeekday(r, weekday)) continue;
      const triggerMin = await this.triggerMinute(r, day);
      if (triggerMin === null) continue;
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, triggerMin, 0);
      if (d === 0 && at.getTime() <= now.getTime()) continue; // 今天的已过
      return at;
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

  /** 动作: 调电源回路服务 (走 4G 适配器/485 适配器路由) */
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

  /** 全量刷新 nextCache (日落跨日/规则变更后调用) */
  async refreshNextRuns(): Promise<void> {
    const rows = await this.repo.find({ where: { enabled: true } });
    for (const r of rows) {
      const at = await this.calcNextDateUncached(r);
      this.nextCache.set(r.id, at ?? new Date(0));
      if (at) {
        await this.repo.update(r.id, { nextRunAt: at });
      }
    }
  }

  private async calcNextDateUncached(r: PowerSchedule): Promise<Date | null> {
    const now = new Date();
    for (let d = 0; d < 4; d += 1) {
      const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() + d);
      const weekday = (day.getDay() + 6) % 7 + 1;
      if (!this.matchesWeekday(r, weekday)) continue;
      const triggerMin = await this.triggerMinute(r, day);
      if (triggerMin === null) continue;
      const at = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, triggerMin, 0);
      if (d === 0 && at.getTime() <= now.getTime()) continue;
      return at;
    }
    return null;
  }

  private assertValid(dto: PowerScheduleInput): void {
    if (!dto.circuitId) throw new Error('circuitId 必填');
    if (dto.action !== 'on' && dto.action !== 'off') throw new Error('action 只能是 on/off');
    if (!['fixed', 'sunset', 'sunrise'].includes(dto.mode)) throw new Error('mode 只能是 fixed/sunset/sunrise');
    if (dto.mode === 'fixed' && !dto.time) throw new Error('fixed 模式必须填 time');
    if (dto.mode === 'fixed' && dto.time && !/^\d{1,2}:\d{2}$/.test(dto.time)) throw new Error('time 格式应为 HH:mm');
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
