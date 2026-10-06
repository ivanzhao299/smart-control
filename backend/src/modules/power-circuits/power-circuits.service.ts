import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
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
import { ControlBus } from '../../services/control-bus';

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
export class PowerCircuitsService implements OnModuleInit, OnModuleDestroy {
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
    /** 事件总线: 后台采集到读数后 WS 广播 — Optional: 单测桩不传也能跑 */
    @Optional() private readonly bus?: ControlBus,
  ) {}

  /**
   * 断路器读数快照 —— 由后台采集循环 (onModuleInit, 每 10s) 主动刷新; toView()
   * 只读快照、不打设备, 云慢/设备休眠/转换器掉线都不影响页面。读失败保留上一次好值。
   */
  private breakerCache = new Map<number, { at: number; reading: PowerReading }>();

  /**
   * 时序器状态快照 —— 由后台采集循环 (onModuleInit, 每 SEQ_POLL_INTERVAL_MS)
   * 主动发**一次** readStatus (0xac 一帧就带全部 8 路状态) 写回; toView() 只读快照、
   * 不开 COM 口。串口慢/时序器掉线/端口被占都不影响页面, 读失败保留上一次好值。
   */
  private seqCache: { at: number; channels: boolean[] } | null = null;
  private seqCollecting = false;
  private seqTimer?: NodeJS.Timeout;
  private readonly SEQ_POLL_INTERVAL_MS = 10_000;

  /**
   * 后台主动采集 (彻底版): 不等到用户请求才读断路器。定时 (10s) 统一调度——
   * 云断路器 HTTP 并行、485 共享串口串行, 结果写内存快照; 读数变化经 ControlBus
   * WS 广播。list/detail 只读快照, 永不被云慢/设备休眠阻塞。
   */
  private collectTimer?: NodeJS.Timeout;
  private collecting = false;
  private readonly COLLECT_INTERVAL_MS = 10_000;

  async list(opts: { includeDisabled?: boolean } = {}): Promise<PowerCircuitView[]> {
    const where = opts.includeDisabled ? {} : { enabled: true };
    const rows = await this.repo.find({
      where,
      order: { floor: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    // 并行拉各回路实时读数 (云断路器走各自 HTTP 可并发; 485 适配器内部对共享
    // 串口自行串行化) —— 避免逐台 await 把云端往返时间累加
    return Promise.all(rows.map((r) => this.toView(r)));
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
      let final: PowerReading | null = pre.ok && pre.data ? this.storeMeasurements(row, pre.data) : null;
      if (!already) {
        // 真·物理总闸: 失败必须抛出去, 绝不能让前端显示"断电成功"而闸没动
        const r = on
          ? await breakerAdapter.turnOn(row.gatewayCode as string)
          : await breakerAdapter.turnOff(row.gatewayCode as string);
        if (!r.ok) {
          throw new ConflictException(`空开${on ? '合闸' : '分闸'}失败: ${r.error ?? '未知错误'}`);
        }
        this.breakerCache.delete(row.id); // 状态刚变, 别再拿旧读数糊弄前端
        // 等物理闸走完再返回: 电机合/分闸 ~1s, 命令一回来读到的还是动作前状态。
        // 轮询到 switchState 翻转为止 (上限 4s), 每帧都写快照; 超时不报错——命令已
        // 确认成功, 状态让后台 10s 采集兜底。
        for (let i = 0; i < 10; i += 1) {
          await new Promise((res) => setTimeout(res, 400));
          const m = await breakerAdapter.getMeasurements(row.gatewayCode as string);
          if (m.ok && m.data) final = this.storeMeasurements(row, m.data);
          if (m.ok && m.data?.switchState === wanted) break;
        }
      }
      if (final) this.publishReading(row, final); // 操作/幂等后即时 WS 推送
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
      // 乐观置位快照让 UI 立即稳定; 不在请求路径读真机 (各路开/关延时使翻转不可靠),
      // 数秒后由后台 collectSequencer 以真机为准校正
      const chIdx = (row.relayChannel ?? 0) - 1;
      if (!this.seqCache) this.seqCache = { at: Date.now(), channels: new Array(8).fill(false) };
      if (chIdx >= 0 && chIdx < this.seqCache.channels.length) {
        this.seqCache.channels[chIdx] = on;
        this.seqCache.at = Date.now();
      }
      this.scheduleSeqRefresh(4000);
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
  // ===== 断路器读数: 请求路径只读快照, 外部 I/O 只在后台采集发生 =====

  /** 请求路径: 纯内存快照, 永不 await 外部 I/O (SWR: 有缓存即返回, 哪怕已过期) */
  private snapshotBreakerReading(row: PowerCircuit): PowerReading {
    const cached = this.breakerCache.get(row.id);
    if (cached) return cached.reading;
    return {
      on: false,
      current: 0,
      voltage: 0,
      power: 0,
      powerFactor: 0,
      energy: 0,
      lastReadAt: new Date().toISOString(),
    };
  }

  /** 把一帧计量映射成统一读数并写入快照 */
  private storeMeasurements(row: PowerCircuit, m: BreakerMeasurements): PowerReading {
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

  /** 后台采集: 真正 await 设备读数; 失败保留上一次快照, 不用 0 覆盖 */
  private async refreshBreakerReading(
    row: PowerCircuit,
    breakerAdapter: EpaBreakerAdapter | EpaMqttBreakerAdapter | HperforApiAdapter,
  ): Promise<PowerReading | null> {
    const r = await breakerAdapter.getMeasurements(row.gatewayCode as string);
    if (!r.ok || !r.data) {
      this.logger.warn(`空开读数失败 circuit=${row.code}: ${r.error ?? '无数据'}`, {
        context: 'PowerCircuitsService',
      });
      return this.breakerCache.get(row.id)?.reading ?? null;
    }
    return this.storeMeasurements(row, r.data);
  }

  /** 经事件总线 WS 广播读数 (业主/管理员电源页实时刷新) */
  private publishReading(row: PowerCircuit, reading: PowerReading): void {
    this.bus?.publish({
      type: 'power_reading',
      circuitId: row.id,
      code: row.code,
      reading: {
        on: reading.on,
        voltage: reading.voltage,
        current: reading.current,
        power: reading.power,
        powerFactor: reading.powerFactor,
        energy: reading.energy,
        lastReadAt: reading.lastReadAt,
      },
      at: new Date().toISOString(),
    });
  }

  /** 是否值得推送: 开关态变化, 或电压/电流/功率超阈值波动 (避免每 10s 无谓广播) */
  private readingChanged(prev: PowerReading, next: PowerReading): boolean {
    if (prev.on !== next.on) return true;
    if (Math.abs(prev.voltage - next.voltage) > 1) return true;
    if (Math.abs(prev.current - next.current) > 0.1) return true;
    if (Math.abs(prev.power - next.power) > 1) return true;
    return false;
  }

  // ===== 生命周期: 后台主动采集循环 =====

  onModuleInit(): void {
    const timer = setInterval(() => { void this.collectOnce(); }, this.COLLECT_INTERVAL_MS);
    timer.unref?.();
    this.collectTimer = timer;
    void this.collectOnce(); // 启动即采一次, 不等 10s

    // 时序器后台采集: 定时一帧 readStatus 写快照, 页面只读快照不碰串口
    const seqTimer = setInterval(() => { void this.collectSequencer(); }, this.SEQ_POLL_INTERVAL_MS);
    seqTimer.unref?.();
    this.seqTimer = seqTimer;
    void this.collectSequencer();
  }

  onModuleDestroy(): void {
    if (this.collectTimer) clearInterval(this.collectTimer);
    this.collectTimer = undefined;
    if (this.seqTimer) clearInterval(this.seqTimer);
    this.seqTimer = undefined;
  }

  /** 一轮采集: 云断路器并行、485/MQTT 串行 (共享物理总线), 变化才广播 */
  private async collectOnce(): Promise<void> {
    if (this.collecting) return;
    this.collecting = true;
    try {
      const rows = await this.repo.find({ where: { enabled: true } });
      const serial: PowerCircuit[] = [];
      const parallel: PowerCircuit[] = [];
      for (const row of rows) {
        const adapter = await this.resolveBreakerAdapter(row);
        if (!adapter) continue;
        if (adapter instanceof HperforApiAdapter) parallel.push(row);
        else serial.push(row); // 485 / MQTT: 保守串行, 避免共享总线冲突
      }
      await Promise.all(parallel.map((r) => this.refreshAndPublish(r)));
      for (const r of serial) await this.refreshAndPublish(r);
    } catch (err) {
      this.logger.warn(`后台采集断路器异常: ${(err as Error).message}`, {
        context: 'PowerCircuitsService',
      });
    } finally {
      this.collecting = false;
    }
  }

  /** 读一台最新读数, 与上次快照比较, 首次/有变化才 WS 推送 */
  private async refreshAndPublish(row: PowerCircuit): Promise<void> {
    const adapter = await this.resolveBreakerAdapter(row);
    if (!adapter) return;
    const prev = this.breakerCache.get(row.id)?.reading;
    const reading = await this.refreshBreakerReading(row, adapter);
    if (!reading) return;
    if (!prev || this.readingChanged(prev, reading)) this.publishReading(row, reading);
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
  /**
   * 后台采集时序器全状态: 发一次 0xac 帧 (一帧带全部 8 路) 写快照。
   * 只在后台定时/操作后调度时运行, 永不在页面请求路径; 读失败保留上次好值、不覆盖。
   */
  private async collectSequencer(): Promise<void> {
    if (this.seqCollecting) return;
    this.seqCollecting = true;
    try {
      const r = await this.epo.readStatus();
      if (r.ok && r.data?.channels) {
        this.seqCache = { at: Date.now(), channels: r.data.channels };
      } else {
        this.logger.warn(`时序器读状态失败: ${r.error ?? '无数据'}`, {
          context: 'PowerCircuitsService',
        });
      }
    } finally {
      this.seqCollecting = false;
    }
  }

  /** 操作后等设备按各路延时动作完, 再后台刷新快照 (不阻塞当前请求) */
  private scheduleSeqRefresh(delayMs: number): void {
    const t = setTimeout(() => { void this.collectSequencer(); }, delayMs);
    t.unref?.();
  }

  /**
   * 时序器回路读数 — 只读后台快照、不开串口; 快照未就绪时 on=false, 不让电源页崩。
   */
  private seqReading(row: PowerCircuit): PowerReading {
    const ch = (row.relayChannel ?? 0) - 1;
    return {
      on: this.seqCache?.channels[ch] ?? false,
      current: 0,
      voltage: 0,
      power: 0,
      powerFactor: 0,
      energy: 0,
      lastReadAt: this.seqCache ? new Date(this.seqCache.at).toISOString() : new Date().toISOString(),
    };
  }

  /**
   * 时序器全开/全关 (b3) — 设备按各路设定延时**依次**动作 (实测配置: 开 1,3,..15s,
   * 关 15,13,..1s 先开后关), 保护功放。这是时序器的正经用法, 电源页"时序开机/关机"按钮用。
   */
  async sequencerAll(on: boolean): Promise<void> {
    const r = await this.epo.setAll(on);
    if (!r.ok) throw new ConflictException(`时序器${on ? '开' : '关'}机失败: ${r.error ?? '未知'}`);
    // 八路按 1..15s 延时依次动作; 保留旧快照(别让页面闪成全 0), 动作完后后台刷新
    this.scheduleSeqRefresh(20_000);
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
        reading: this.snapshotBreakerReading(row), // 读快照, 不等待外部 I/O
      };
    }
    // 时序器回路: 开关状态读后台快照 (0xac 一帧带全部 8 路), 电量指标时序器没有 → 0
    if (await this.isSequencerCircuit(row)) {
      return { ...this.baseView(row), isBreaker, reading: this.seqReading(row) };
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
