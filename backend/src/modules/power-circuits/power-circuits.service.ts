import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerAdapter, PowerReading } from '../../adapters/power/power.adapter';
import { Epo802pAdapter } from '../../adapters/power/epo802p.adapter';
import { EpaBreakerAdapter } from '../../adapters/power/epa-breaker.adapter';
import type { BreakerMeasurements } from '../../adapters/power/epa-breaker-registers';
import { HardwareUnit } from '../../entities/hardware-unit.entity';

export interface PowerCircuitView {
  id: number;
  code: string;
  name: string;
  floor: string;
  category: string;
  gatewayCode: string | null;
  relayChannel: number | null;
  meterAddress: number | null;
  ratedVoltage: number;
  ratedCurrent: number;
  ratedPower: number;
  sortOrder: number;
  icon: string | null;
  description: string | null;
  enabled: boolean;
  /** 是不是智能断路器回路 (前端据此显示空开专属详情 + 隐藏"CH -") */
  isBreaker: boolean;
  /** 实时数据 (从 adapter 拉, mock 时为模拟值) */
  reading: PowerReading;
  createdAt: Date;
  updatedAt: Date;
}

export interface PowerCircuitUpsertDto {
  code: string;
  name: string;
  floor: string;
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

/** 启动自动 seed — 没有 power_circuit 行时灌入 6 条示例 */
const SEED_CIRCUITS: Array<Omit<PowerCircuitUpsertDto, 'enabled'> & { enabled?: boolean }> = [
  { code: '1f-main', name: '一层总闸', floor: '1F', category: 'misc',
    gatewayCode: 'RELAY-1F-1', relayChannel: 1,
    ratedVoltage: 380, ratedCurrent: 63, ratedPower: 24000,
    sortOrder: 1, icon: 'Zap', description: '一层进线总开关 (3 相)' },
  { code: '1f-lighting', name: '一层照明回路', floor: '1F', category: 'lighting',
    gatewayCode: 'RELAY-1F-1', relayChannel: 2,
    ratedVoltage: 220, ratedCurrent: 16, ratedPower: 2200,
    sortOrder: 10, icon: 'Lightbulb' },
  { code: '1f-socket', name: '一层插座回路', floor: '1F', category: 'socket',
    gatewayCode: 'RELAY-1F-1', relayChannel: 3,
    ratedVoltage: 220, ratedCurrent: 16, ratedPower: 1500,
    sortOrder: 20, icon: 'Plug' },
  // LED 大屏总闸走 ePa 智能断路器 (三相 40A), 不是继电器通道 —— relayChannel 留空
  { code: '1f-led', name: '一层 LED 大屏', floor: '1F', category: 'led',
    gatewayCode: 'BREAKER-LED-1', relayChannel: null,
    ratedVoltage: 380, ratedCurrent: 40, ratedPower: 19000,
    sortOrder: 30, icon: 'MonitorPlay', description: 'LED 大屏远程总闸 (ePa 智能断路器, 三相 40A)' },
  { code: '2f-lighting', name: '二层照明回路', floor: '2F', category: 'lighting',
    gatewayCode: 'RELAY-2F-1', relayChannel: 1,
    ratedVoltage: 220, ratedCurrent: 16, ratedPower: 1800,
    sortOrder: 10, icon: 'Lightbulb' },
  { code: '2f-hvac', name: '二层空调回路', floor: '2F', category: 'hvac',
    gatewayCode: 'RELAY-2F-1', relayChannel: 2,
    ratedVoltage: 380, ratedCurrent: 40, ratedPower: 12000,
    sortOrder: 20, icon: 'Snowflake' },
  // ---- 音响电源时序器 EPO-802P (COM1 直连, 2026-07-24 端口实测通) ----
  // 8 路时序上电保护功放。名字是占位, 业主在电源页可直接改 (rename 端点),
  // seed 按 code 幂等, 改过的名字不会被冲掉。
  ...Array.from({ length: 8 }, (_, i) => ({
    code: `seq-${i + 1}`,
    name: `时序 ${i + 1} 路`,
    floor: '音响',
    category: 'audio-seq',
    gatewayCode: 'AUDIO-PWR-SEQ-1',
    relayChannel: i + 1,
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 2000,
    sortOrder: 100 + i,
    icon: 'Plug',
    description: `EPO-802P 时序器通道 ${i + 1}`,
  })),
];

@Injectable()
export class PowerCircuitsService implements OnModuleInit {
  constructor(
    @InjectRepository(PowerCircuit) private readonly repo: Repository<PowerCircuit>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    private readonly adapter: PowerAdapter,
    /** 电源时序器真机 — 挂在它上面的回路走真设备, 其余走 mock */
    private readonly epo: Epo802pAdapter,
    /** 智能断路器真机 — LED 大屏总闸 */
    private readonly breaker: EpaBreakerAdapter,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 断路器实时读数缓存 —— toView() 每列一行都会调, list() 一次会调 6 次。
   * 没缓存的话每次翻页都往 485 上打一串 Modbus 帧, 而且转换器掉线时每行都要等满
   * DEVICE_TIMEOUT_MS, 整个电源页会卡死。TTL 内复用, 读失败回落到上一次好的值。
   */
  private breakerCache = new Map<number, { at: number; reading: PowerReading }>();
  private readonly BREAKER_CACHE_TTL_MS = 3000;

  /**
   * 时序器状态缓存 —— 8 路回路共享**一次** readStatus (0xac 一帧就带全部 8 路状态),
   * 不然 list() 一次要开关 COM 口 8 遍。TTL 内复用; 读失败回落上一次好值。
   */
  private seqCache: { at: number; channels: boolean[] } | null = null;
  private readonly SEQ_CACHE_TTL_MS = 3000;

  async onModuleInit(): Promise<void> {
    let created = 0;
    for (const c of SEED_CIRCUITS) {
      const exists = await this.repo.findOne({ where: { code: c.code } });
      if (exists) continue;
      await this.repo.save(this.repo.create({
        code: c.code,
        name: c.name,
        floor: c.floor,
        category: c.category ?? 'misc',
        gatewayCode: c.gatewayCode ?? null,
        relayChannel: c.relayChannel ?? null,
        meterAddress: c.meterAddress ?? null,
        ratedVoltage: c.ratedVoltage ?? 220,
        ratedCurrent: c.ratedCurrent ?? 16,
        ratedPower: c.ratedPower ?? 0,
        sortOrder: c.sortOrder ?? 100,
        icon: c.icon ?? 'Zap',
        description: c.description ?? null,
        enabled: c.enabled ?? true,
      }));
      created += 1;
    }
    if (created > 0) {
      this.logger.info(`PowerCircuitsService bootstrap: 自动注入 ${created} 条电源回路`, {
        context: 'PowerCircuitsService',
      });
    }
    await this.healLedCircuitToBreaker();
  }

  /**
   * 一次性自愈 (2026-07-22): LED 大屏回路原来指向 RELAY-1F-1 通道 4 —— 那是一台从没到货的
   * 继电器, 点了没有任何反应。现在真闸装好了 (ePa 智能断路器 + CONV-RTU-2), 把这条回路
   * 改指 BREAKER-LED-1, 顺便把额定值从占位的 220V/20A/3500W 改成实际的三相 380V/40A/19KW。
   *
   * 上面的 seed 遇到已存在的 code 就跳过, 所以生产库的旧行不会被改 —— 只能在这里补。
   * 只在"值还是当初那个占位值"时才动, 人工调过的一律不碰。
   */
  private async healLedCircuitToBreaker(): Promise<void> {
    const row = await this.repo.findOne({ where: { code: '1f-led' } });
    if (!row || row.gatewayCode !== 'RELAY-1F-1') return;
    row.gatewayCode = 'BREAKER-LED-1';
    row.relayChannel = null;
    if (row.ratedVoltage === 220) row.ratedVoltage = 380;
    if (row.ratedCurrent === 20) row.ratedCurrent = 40;
    if (row.ratedPower === 3500) row.ratedPower = 19000;
    if (!row.description) row.description = 'LED 大屏远程总闸 (ePa 智能断路器, 三相 40A)';
    await this.repo.save(row);
    this.logger.info('电源回路自愈: 1f-led RELAY-1F-1 → BREAKER-LED-1 (真空开已装机)', {
      context: 'PowerCircuitsService',
    });
  }

  async list(opts: { includeDisabled?: boolean } = {}): Promise<PowerCircuitView[]> {
    const where = opts.includeDisabled ? {} : { enabled: true };
    const rows = await this.repo.find({
      where,
      order: { floor: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    // 拉每个 circuit 的实时数据 (mock adapter 同步返回, 几乎零成本)
    const out: PowerCircuitView[] = [];
    for (const r of rows) {
      out.push(await this.toView(r));
    }
    return out;
  }

  async detail(id: number): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    return this.toView(row);
  }

  async create(dto: PowerCircuitUpsertDto): Promise<PowerCircuitView> {
    this.validate(dto);
    const dup = await this.repo.findOne({ where: { code: dto.code } });
    if (dup) throw new ConflictException(`circuit code 已存在: ${dto.code}`);
    const row = this.repo.create({
      code: dto.code, name: dto.name, floor: dto.floor,
      category: dto.category ?? 'misc',
      gatewayCode: dto.gatewayCode ?? null,
      relayChannel: dto.relayChannel ?? null,
      meterAddress: dto.meterAddress ?? null,
      ratedVoltage: dto.ratedVoltage ?? 220,
      ratedCurrent: dto.ratedCurrent ?? 16,
      ratedPower: dto.ratedPower ?? 0,
      sortOrder: dto.sortOrder ?? 100,
      icon: dto.icon ?? 'Zap',
      description: dto.description ?? null,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.repo.save(row);
    return this.toView(saved);
  }

  async update(id: number, dto: Partial<PowerCircuitUpsertDto>): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    if (dto.code && dto.code !== row.code) {
      const dup = await this.repo.findOne({ where: { code: dto.code } });
      if (dup && dup.id !== id) throw new ConflictException(`circuit code 已存在: ${dto.code}`);
    }
    Object.assign(row, {
      ...(dto.code !== undefined && { code: dto.code }),
      ...(dto.name !== undefined && { name: dto.name }),
      ...(dto.floor !== undefined && { floor: dto.floor }),
      ...(dto.category !== undefined && { category: dto.category }),
      ...(dto.gatewayCode !== undefined && { gatewayCode: dto.gatewayCode }),
      ...(dto.relayChannel !== undefined && { relayChannel: dto.relayChannel }),
      ...(dto.meterAddress !== undefined && { meterAddress: dto.meterAddress }),
      ...(dto.ratedVoltage !== undefined && { ratedVoltage: dto.ratedVoltage }),
      ...(dto.ratedCurrent !== undefined && { ratedCurrent: dto.ratedCurrent }),
      ...(dto.ratedPower !== undefined && { ratedPower: dto.ratedPower }),
      ...(dto.sortOrder !== undefined && { sortOrder: dto.sortOrder }),
      ...(dto.icon !== undefined && { icon: dto.icon }),
      ...(dto.description !== undefined && { description: dto.description }),
      ...(dto.enabled !== undefined && { enabled: dto.enabled }),
    });
    const saved = await this.repo.save(row);
    return this.toView(saved);
  }

  async remove(id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return;
    await this.repo.delete({ id });
  }

  /** 通电 — 走 adapter, 然后返回最新读数 */
  async turnOn(id: number): Promise<PowerCircuitView> {
    return this.switchCircuit(id, true);
  }

  async turnOff(id: number): Promise<PowerCircuitView> {
    return this.switchCircuit(id, false);
  }

  /**
   * 回路通断 — 挂在电源时序器上的回路打真设备, 其余仍走 mock.
   *
   * 判断依据: hardware_unit 里 gatewayCode 对应那台的 category='audio-power'
   * (EPO-802P), relayChannel 就是它的 1-8 路。这样接了真设备的回路立刻生效,
   * 没接的 (RELAY-1F-1 之类还没到货的继电器) 保持原样, 不会报错。
   */
  private async switchCircuit(id: number, on: boolean): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    if (!row.enabled) throw new ConflictException(`circuit ${row.name} 已禁用`);

    if (await this.isBreakerCircuit(row)) {
      // 真·物理总闸: 失败必须抛出去, 绝不能让前端显示"断电成功"而闸没动
      const r = on
        ? await this.breaker.turnOn(row.code)
        : await this.breaker.turnOff(row.code);
      if (!r.ok) {
        throw new ConflictException(`空开${on ? '合闸' : '分闸'}失败: ${r.error ?? '未知错误'}`);
      }
      this.breakerCache.delete(row.id); // 状态刚变, 别再拿旧读数糊弄前端
      this.logger.info(`空开${on ? '合闸' : '分闸'}: circuit=${row.code}`, {
        context: 'PowerCircuitsService',
      });
    } else if (await this.isSequencerCircuit(row)) {
      await this.epo.setChannel(row.relayChannel as number, on);
    }
    // mock adapter 仍要跑: 它维护 PowerPage 用的电量/读数状态
    if (on) await this.adapter.circuitTurnOn(id);
    else await this.adapter.circuitTurnOff(id);

    return this.toView(row);
  }

  /** 这条回路是不是挂在 ePa 智能断路器上 (不吃 relayChannel, 整台闸就是一条回路) */
  private async isBreakerCircuit(row: PowerCircuit): Promise<boolean> {
    if (!row.gatewayCode) return false;
    try {
      const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
      return hw?.category === 'power-breaker' && hw.enabled;
    } catch {
      return false;
    }
  }

  /**
   * 断路器回路的真实读数 —— 三相取值口径:
   *   voltage = 三相平均 (现场三相基本平衡, 平均值最能代表这条回路)
   *   current = 三相最大 (40A 保护看的是最重的那一相, 用平均会把偏载藏起来)
   *   power / energy = 总量 (第 4 个元素就是总)
   * 读不到就回落到缓存里上一次的好值, 再没有就返回全 0 + on=false, 不让电源页崩。
   */
  private async breakerReading(row: PowerCircuit): Promise<PowerReading> {
    const cached = this.breakerCache.get(row.id);
    if (cached && Date.now() - cached.at < this.BREAKER_CACHE_TTL_MS) return cached.reading;

    const r = await this.breaker.getMeasurements(row.code);
    if (!r.ok || !r.data) {
      this.logger.warn(`空开读数失败 circuit=${row.code}: ${r.error ?? '无数据'}`, {
        context: 'PowerCircuitsService',
      });
      return cached?.reading ?? {
        on: false, current: 0, voltage: 0, power: 0, powerFactor: 0, energy: 0,
        lastReadAt: new Date().toISOString(),
      };
    }
    const m: BreakerMeasurements = r.data;
    const reading: PowerReading = {
      on: m.switchState === 'closed',
      voltage: Number((m.voltages.reduce((a, b) => a + b, 0) / 3).toFixed(1)),
      current: Number(Math.max(...m.currents).toFixed(3)),
      power: m.powers[3],
      powerFactor: m.powerFactor,
      energy: m.energies[3],
      lastReadAt: new Date().toISOString(),
    };
    this.breakerCache.set(row.id, { at: Date.now(), reading });
    return reading;
  }

  /** 断路器全量计量 (三相分相 + 温度 + 漏电 + 报警位) — 给运维/详情页看 */
  async breakerMeasurements(id: number): Promise<BreakerMeasurements> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    if (!(await this.isBreakerCircuit(row))) {
      throw new ConflictException(`circuit ${row.name} 不是智能断路器回路`);
    }
    const r = await this.breaker.getMeasurements(row.code);
    if (!r.ok || !r.data) {
      throw new ConflictException(`读空开失败: ${r.error ?? '无数据'}`);
    }
    return r.data;
  }

  /**
   * 时序器回路读数 — 8 路共享一次 0xac 全状态帧 (seqCache)。
   * 读失败回落上次好值; 再没有就 on=false, 不让电源页崩。
   */
  private async seqReading(row: PowerCircuit): Promise<PowerReading> {
    const ch = (row.relayChannel ?? 0) - 1;
    let channels: boolean[] | null = null;
    if (this.seqCache && Date.now() - this.seqCache.at < this.SEQ_CACHE_TTL_MS) {
      channels = this.seqCache.channels;
    } else {
      const r = await this.epo.readStatus();
      if (r.ok && r.data?.channels) {
        channels = r.data.channels;
        this.seqCache = { at: Date.now(), channels };
      } else {
        this.logger.warn(`时序器读状态失败 circuit=${row.code}: ${r.error ?? '无数据'}`, {
          context: 'PowerCircuitsService',
        });
        channels = this.seqCache?.channels ?? null;
      }
    }
    return {
      on: channels?.[ch] ?? false,
      current: 0, voltage: 0, power: 0, powerFactor: 0, energy: 0,
      lastReadAt: new Date().toISOString(),
    };
  }

  /**
   * 时序器全开/全关 (b3) — 设备按各路设定延时**依次**动作 (实测配置: 开 1,3,..15s,
   * 关 15,13,..1s 先开后关), 保护功放。这是时序器的正经用法, 电源页"时序开机/关机"按钮用。
   */
  async sequencerAll(on: boolean): Promise<void> {
    const r = await this.epo.setAll(on);
    if (!r.ok) throw new ConflictException(`时序器${on ? '开' : '关'}机失败: ${r.error ?? '未知'}`);
    this.seqCache = null; // 状态马上要变, 缓存作废
  }

  /** 改名 (业主在电源页直接改, 不需要 admin) */
  async rename(id: number, name: string): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    const trimmed = (name ?? '').trim();
    if (!trimmed) throw new ConflictException('名称不能为空');
    if (trimmed.length > 32) throw new ConflictException('名称最长 32 字');
    row.name = trimmed;
    return this.toView(await this.repo.save(row));
  }

  /** 这条回路是不是挂在 EPO-802P 时序器上 */
  private async isSequencerCircuit(row: PowerCircuit): Promise<boolean> {
    if (!row.gatewayCode || !row.relayChannel) return false;
    try {
      const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
      return hw?.category === 'audio-power' && hw.enabled;
    } catch {
      return false;
    }
  }

  // ============ 内部 ============

  private validate(dto: PowerCircuitUpsertDto): void {
    if (!dto.code) throw new ConflictException('code 必填');
    if (!dto.name) throw new ConflictException('name 必填');
    if (!dto.floor) throw new ConflictException('floor 必填');
  }

  private async toView(row: PowerCircuit): Promise<PowerCircuitView> {
    const isBreaker = await this.isBreakerCircuit(row);
    // 智能断路器回路: 读真机 (电压/电流/功率/电量都是实测), 不用 mock 的模拟值
    if (isBreaker) {
      return { ...this.baseView(row), isBreaker, reading: await this.breakerReading(row) };
    }
    // 时序器回路: 开关状态读真机 (0xac 一帧带全部 8 路), 电量指标时序器没有 → 0
    if (await this.isSequencerCircuit(row)) {
      return { ...this.baseView(row), isBreaker, reading: await this.seqReading(row) };
    }
    const result = await this.adapter.circuitReadStatus(row.id, {
      voltage: row.ratedVoltage,
      current: row.ratedCurrent,
      power: row.ratedPower,
    });
    const reading: PowerReading = result.ok && result.data
      ? result.data
      : { on: false, current: 0, voltage: 0, power: 0, powerFactor: 0, energy: 0, lastReadAt: new Date().toISOString() };
    return { ...this.baseView(row), isBreaker, reading };
  }

  /** 行字段 → view (不含 reading / isBreaker, 两条读数路径共用) */
  private baseView(row: PowerCircuit): Omit<PowerCircuitView, 'reading' | 'isBreaker'> {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      floor: row.floor,
      category: row.category,
      gatewayCode: row.gatewayCode,
      relayChannel: row.relayChannel,
      meterAddress: row.meterAddress,
      ratedVoltage: row.ratedVoltage,
      ratedCurrent: row.ratedCurrent,
      ratedPower: row.ratedPower,
      sortOrder: row.sortOrder,
      icon: row.icon,
      description: row.description,
      enabled: row.enabled,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
