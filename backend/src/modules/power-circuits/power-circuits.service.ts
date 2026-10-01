import { ConflictException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerAdapter, PowerReading } from '../../adapters/power/power.adapter';
import { Epo802pAdapter } from '../../adapters/power/epo802p.adapter';
import { Seq55Adapter } from '../../adapters/power/seq55.adapter';
import { EpaBreakerAdapter } from '../../adapters/power/epa-breaker.adapter';
import { EpaMqttBreakerAdapter } from '../../adapters/power/epa-mqtt-breaker.adapter';
import { HperforApiAdapter } from '../../adapters/power/hperfor-api.adapter';
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

@Injectable()
export class PowerCircuitsService {
  constructor(
    @InjectRepository(PowerCircuit) private readonly repo: Repository<PowerCircuit>,
    @InjectRepository(HardwareUnit) private readonly hwRepo: Repository<HardwareUnit>,
    private readonly adapter: PowerAdapter,
    /** 电源时序器真机 — 挂在它上面的回路走真设备, 其余走 mock */
    private readonly epo: Epo802pAdapter,
    /** 485 智能断路器 — LED 大屏总闸及同总线扩展回路 */
    private readonly breaker: EpaBreakerAdapter,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    /** 第二台时序器 (55…AA 协议, 2026-07-29 备) — Optional: 既有单测桩不传也能构造 */
    @Optional() private readonly seq55?: Seq55Adapter,
    /** 4G/MQTT 智能断路器 — 未启用时仍可安全保存设备配置，但不会下发 */
    @Optional() private readonly cloudBreaker?: EpaMqttBreakerAdapter,
    /** 4G 断路器走华普云 Web API (庭院亮化/鱼池供氧/园区路灯) — Optional: 未配置凭据时不下发 */
    @Optional() private readonly webBreaker?: HperforApiAdapter,
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
      code: dto.code,
      name: dto.name,
      floor: dto.floor,
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

  /**
   * 通电 — 走 adapter, 然后返回最新读数。
   * 不做任何跨回路联动 (2026-07-28 业主二次修正: "同开同关只限于 LED/投影页面
   * 顶部那个开关; 时序器各路要能单独控制、保持各自状态") —— 页面级分组开关由
   * 前端 PlayerConsole 的 powerCode/powerNameGroups 组合完成, 这里保持单路语义,
   * 电源页逐路开关互不牵连。(07-28 早些时候的 turnOn 后端联动版已按此撤销。)
   */
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

    const breakerAdapter = await this.resolveBreakerAdapter(row);
    if (breakerAdapter) {
      const wanted = on ? 'closed' : 'open';
      // 幂等 (2026-10-01 业主: 园区已通电再点"通电"会报错): 下发前先读当前态,
      // 已处于目标态就不重复合/分闸 (设备/云平台对重复命令会拒), 按成功 no-op 处理。
      const pre = await breakerAdapter.getMeasurements(row.gatewayCode as string);
      const already = pre.ok && pre.data?.switchState === wanted;
      if (!already) {
        // 真·物理总闸: 失败必须抛出去, 绝不能让前端显示"断电成功"而闸没动
        const r = on
          ? await breakerAdapter.turnOn(row.gatewayCode as string)
          : await breakerAdapter.turnOff(row.gatewayCode as string);
        if (!r.ok) {
          throw new ConflictException(`空开${on ? '合闸' : '分闸'}失败: ${r.error ?? '未知错误'}`);
        }
        this.breakerCache.delete(row.id); // 状态刚变, 别再拿旧读数糊弄前端
        // 等物理闸走完再返回 (2026-07-24 业主: "按钮状态未能与实际开关状态一致"):
        // 电机合/分闸要 ~1s, 命令一回来就读, 读到的还是动作前的状态 —— 前端拿这个
        // "旧状态"覆盖乐观 UI, 按钮当场跳回。轮询到 switchState 翻转为止 (上限 4s,
        // 超时不报错 —— 命令已确认成功, 状态让下一轮 8s 轮询兜底)。
        for (let i = 0; i < 10; i += 1) {
          await new Promise((res) => setTimeout(res, 400));
          const m = await breakerAdapter.getMeasurements(row.gatewayCode as string);
          if (m.ok && m.data?.switchState === wanted) break;
        }
        this.breakerCache.delete(row.id); // 轮询期间 breakerReading 可能又缓存了旧值
      } else {
        this.breakerCache.delete(row.id); // 已在目标态, 同样清掉可能的旧缓存
      }
      this.logger.info(
        `空开${on ? '合闸' : '分闸'}: circuit=${row.code}${already ? ' (幂等跳过)' : ''}`,
        { context: 'PowerCircuitsService' },
      );
    } else if (await this.isSeq55Circuit(row)) {
      // 第二台时序器 (55…AA 协议, 2026-07-29 备): 只控不读 (回帧格式待实测),
      // 状态由 mock adapter 维护的乐观值兜底
      if (!this.seq55) throw new ConflictException('seq55 时序器适配器未装载');
      const r = await this.seq55.setChannel(row.relayChannel as number, on);
      if (!r.ok) throw new ConflictException(`时序器下发失败: ${r.error ?? '未知错误'}`);
    } else if (await this.isSequencerCircuit(row)) {
      await this.epo.setChannel(row.relayChannel as number, on);
      // 2026-07-25 业主: "时序器点击回弹, 状态不能保持" — 根因: 下发后没动 seqCache,
      // 紧随的 toView / 5s 轮询读到 3s 缓存里的旧状态, 把前端乐观 UI 打回去。
      // (b2 协议有官方例帧金标准单测, 设备实际动了, 纯 UI 回弹。)
      // 修: 命令确认后按目标值**乐观置位缓存**并把有效期顺延 ~7s —— EPO 每路可能配
      // 开/关延时, 等待翻转不可靠; 置位让 UI 立即稳定, 之后轮询以真机为准。
      const chIdx = (row.relayChannel ?? 0) - 1;
      if (!this.seqCache) {
        const r = await this.epo.readStatus();
        if (r.ok && r.data?.channels) this.seqCache = { at: Date.now(), channels: r.data.channels };
      }
      if (this.seqCache && chIdx >= 0 && chIdx < this.seqCache.channels.length) {
        this.seqCache.channels[chIdx] = on;
        this.seqCache.at = Date.now() + 4000; // TTL 3s, 未来值 => 写后约 7s 内都用乐观态
      }
    }
    // mock adapter 仍要跑: 它维护 PowerPage 用的电量/读数状态
    if (on) await this.adapter.circuitTurnOn(id);
    else await this.adapter.circuitTurnOff(id);

    return this.toView(row);
  }

  private async resolveBreakerAdapter(
    row: PowerCircuit,
  ): Promise<EpaBreakerAdapter | EpaMqttBreakerAdapter | HperforApiAdapter | null> {
    if (!row.gatewayCode) return null;
    const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
    if (!hw?.enabled) return null;
    if (hw.category === 'power-breaker') return this.breaker;
    if (hw.category === 'power-breaker-4g') {
      if (!this.cloudBreaker) throw new ConflictException('4G 智能断路器适配器未装载');
      return this.cloudBreaker;
    }
    if (hw.category === 'power-breaker-web') {
      if (!this.webBreaker) throw new ConflictException('华普云 Web 断路器适配器未装载');
      return this.webBreaker;
    }
    return null;
  }

  /**
   * 断路器回路的真实读数 —— 三相取值口径:
   *   voltage = 三相平均 (现场三相基本平衡, 平均值最能代表这条回路)
   *   current = 三相最大 (40A 保护看的是最重的那一相, 用平均会把偏载藏起来)
   *   power / energy = 总量 (第 4 个元素就是总)
   * 读不到就回落到缓存里上一次的好值, 再没有就返回全 0 + on=false, 不让电源页崩。
   */
  private async breakerReading(
    row: PowerCircuit,
    breakerAdapter: EpaBreakerAdapter | EpaMqttBreakerAdapter | HperforApiAdapter,
  ): Promise<PowerReading> {
    const cached = this.breakerCache.get(row.id);
    if (cached && Date.now() - cached.at < this.BREAKER_CACHE_TTL_MS) return cached.reading;

    const r = await breakerAdapter.getMeasurements(row.gatewayCode as string);
    if (!r.ok || !r.data) {
      this.logger.warn(`空开读数失败 circuit=${row.code}: ${r.error ?? '无数据'}`, {
        context: 'PowerCircuitsService',
      });
      return (
        cached?.reading ?? {
          on: false,
          current: 0,
          voltage: 0,
          power: 0,
          powerFactor: 0,
          energy: 0,
          lastReadAt: new Date().toISOString(),
        }
      );
    }
    const m: BreakerMeasurements = r.data;
    const reading: PowerReading = {
      on: m.switchState === 'closed',
      voltage: Number(this.averagePresentPhases(m.voltages).toFixed(1)),
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
    const breakerAdapter = await this.resolveBreakerAdapter(row);
    if (!breakerAdapter) {
      throw new ConflictException(`circuit ${row.name} 不是智能断路器回路`);
    }
    const r = await breakerAdapter.getMeasurements(row.gatewayCode as string);
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
      current: 0,
      voltage: 0,
      power: 0,
      powerFactor: 0,
      energy: 0,
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

  /** 这条回路是不是挂在第二台时序器 (55…AA 协议) 上 (2026-07-29 备, 到货启用) */
  private async isSeq55Circuit(row: PowerCircuit): Promise<boolean> {
    if (!row.gatewayCode || !row.relayChannel) return false;
    try {
      const hw = await this.hwRepo.findOne({ where: { code: row.gatewayCode } });
      return hw?.category === 'power-seq55' && hw.enabled;
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
    const breakerAdapter = await this.resolveBreakerAdapter(row);
    const isBreaker = breakerAdapter !== null;
    // 智能断路器回路: 读真机 (电压/电流/功率/电量都是实测), 不用 mock 的模拟值
    if (breakerAdapter) {
      return {
        ...this.baseView(row),
        isBreaker,
        reading: await this.breakerReading(row, breakerAdapter),
      };
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
    const reading: PowerReading =
      result.ok && result.data
        ? result.data
        : {
            on: false,
            current: 0,
            voltage: 0,
            power: 0,
            powerFactor: 0,
            energy: 0,
            lastReadAt: new Date().toISOString(),
          };
    return { ...this.baseView(row), isBreaker, reading };
  }

  /** 单相 MQTT 设备只填 A 相；三相设备取三相平均。 */
  private averagePresentPhases(values: [number, number, number]): number {
    const present = values.filter((value) => Number.isFinite(value) && value > 0);
    if (present.length === 0) return 0;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
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
