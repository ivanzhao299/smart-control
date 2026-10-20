import {
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { In, Repository } from 'typeorm';
import { Logger } from 'winston';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { PowerDomain } from '../../entities/power-domain.entity';
import { PowerFloor } from '../../entities/power-floor.entity';
import { canWritePowerDomain, readablePowerDomains, POWER_DOMAIN } from '../../common/auth/rbac';
import { PowerAdapter, PowerReading } from '../../adapters/power/power.adapter';
import { Epo802pAdapter } from '../../adapters/power/epo802p.adapter';
import { Seq55Adapter } from '../../adapters/power/seq55.adapter';
import { EpaBreakerAdapter } from '../../adapters/power/epa-breaker.adapter';
import { EpaMqttBreakerAdapter } from '../../adapters/power/epa-mqtt-breaker.adapter';
import { HperforApiAdapter } from '../../adapters/power/hperfor-api.adapter';
import { EwelinkApiAdapter } from '../../adapters/power/ewelink-api.adapter';
import type { BreakerMeasurements } from '../../adapters/power/epa-breaker-registers';
import { HardwareUnit } from '../../entities/hardware-unit.entity';
import { ControlBus } from '../../services/control-bus';
import { PowerDomainGrantService } from './power-domain-grant.service';

export interface PowerCircuitView {
  id: number;
  code: string;
  name: string;
  floor: string;
  /** 分区中文名（join power_floor.name）；未登记时回退为 floor code 本身，恒有值。 */
  floorName: string;
  /** 所属电源域 code（hall 展厅 / park 园区 / 新楼栋），第五轮域划分。 */
  domainCode: string;
  /** 所属电源域中文名（join power_domain 得到，未配置时回退 code）。 */
  domainName: string | null;
  category: string;
  gatewayCode: string | null;
  /** 所属网关/硬件的中文名（join hardware_units.name，电源页按设备分组时做组标题）。 */
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
  /** 所属电源域 code；不传时默认 hall（展厅）。 */
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

export interface PowerDomainView {
  id: number;
  code: string;
  name: string;
  sortOrder: number;
  description: string | null;
  enabled: boolean;
  /** 该域下回路数量（管理页展示用）。 */
  circuitCount?: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface PowerDomainUpsertDto {
  code?: string;
  name?: string;
  sortOrder?: number;
  description?: string | null;
  enabled?: boolean;
}

export interface PowerFloorView {
  id: number;
  domainCode: string;
  /** 分区稳定标识，回路引用。 */
  code: string;
  /** 中文显示名。 */
  name: string;
  sortOrder: number;
  enabled: boolean;
  /** 该分区下回路数量（管理页展示用）。 */
  circuitCount?: number;
  /** false=孤儿（仅回路里出现、字典未收录），前端可点「收录」。 */
  registered: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface PowerFloorUpsertDto {
  /** 所属域 code；新建/收录必填。 */
  domainCode?: string;
  /** 分区 code；收录孤儿时传回路现有 floor 值，普通新建留空（系统自动生成）。 */
  code?: string;
  name?: string;
  sortOrder?: number;
  enabled?: boolean;
}

@Injectable()
export class PowerCircuitsService implements OnModuleInit, OnModuleDestroy {
  constructor(
    @InjectRepository(PowerCircuit) private readonly repo: Repository<PowerCircuit>,
    @InjectRepository(PowerDomain) private readonly domainRepo: Repository<PowerDomain>,
    @InjectRepository(PowerFloor) private readonly floorRepo: Repository<PowerFloor>,
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
    /** 云开关走易微联 eWeLink OAuth2.0 REST (低价市售开关) — Optional: 未授权时不下发 */
    @Optional() private readonly ewelinkBreaker?: EwelinkApiAdapter,
    /** 事件总线: 后台采集到读数后 WS 广播 — Optional: 单测桩不传也能跑 */
    @Optional() private readonly bus?: ControlBus,
    /** 角色×域授权(DB 矩阵+内存缓存); 单测桩不传时回退 rbac 内置矩阵。 */
    @Optional() private readonly grantService?: PowerDomainGrantService,
  ) {}

  /** 角色可读域集合(null=全域); 优先 DB 授权服务, 缺失/单测回退内置 rbac。 */
  private async readableDomainsForRole(role?: string): Promise<string[] | null> {
    if (this.grantService) return this.grantService.readableDomains(role ?? null);
    return readablePowerDomains(role);
  }

  /** 角色是否可写某域; 优先 DB 授权服务, 缺失/单测回退内置 rbac。 */
  private async canWriteDomainForRole(role: string | undefined, domainCode: string): Promise<boolean> {
    if (this.grantService) return this.grantService.canWrite(role ?? null, domainCode);
    return canWritePowerDomain(role, domainCode);
  }

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
  /**
   * 第二台时序器 (SEQ55, 55…AA 协议, COM4) 的 8 路状态快照 —— 与第一台 EPO
   * **分开存**, 两台串口/协议互不相同, 绝不能让一台的状态覆盖另一台。
   */
  private seq55Cache: { at: number; channels: boolean[] } | null = null;
  private seqCollecting = false;
  /**
   * 正在跑时序动作窗口期的设备 category（非 null）——窗口期内该台的合成逐路快照由
   * runSeqWindow 独占维护，禁止 10s 定时采集 collectSequencer 读真实全目标去覆盖它
   * （EPO 状态字节命令后立即回目标态，会把逐路合成一下冲成全目标）。
   */
  private seqWindowCategory: string | null = null;
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

  async list(opts: { includeDisabled?: boolean; role?: string } = {}): Promise<PowerCircuitView[]> {
    const where: Record<string, unknown> = opts.includeDisabled ? {} : { enabled: true };
    // 数据范围（角色 × 域）：非 admin 只返回其所属域的回路（operator/viewer 仅展厅、
    // config 仅园区、hardware 全域）。readablePowerDomains 返回 null 时不限制。
    const domains = await this.readableDomainsForRole(opts.role);
    if (domains) where.domainCode = In(domains);
    const rows = await this.repo.find({
      where,
      order: { domainCode: 'ASC', floor: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    // 并行拉各回路实时读数 (云断路器走各自 HTTP 可并发; 485 适配器内部对共享
    // 串口自行串行化) —— 避免逐台 await 把云端往返时间累加
    const [nameMap, floorMap, hwMap] = await Promise.all([
      this.domainNameMap(),
      this.floorNameMap(),
      this.hwNameMap(),
    ]);
    return Promise.all(rows.map((r) => this.toView(r, nameMap, floorMap, hwMap)));
  }

  async detail(id: number, role?: string): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    await this.assertCanReadDomain(row, role);
    const [nameMap, floorMap, hwMap] = await Promise.all([
      this.domainNameMap(),
      this.floorNameMap(),
      this.hwNameMap(),
    ]);
    return this.toView(row, nameMap, floorMap, hwMap);
  }

  /**
   * 按 code 查单个回路（共享回路「最后离开才关」轻量判定用）：只查一条，时序器状态读
   * 后台快照、不开 COM 口，比全量 list 更省。
   */
  async detailByCode(code: string, role?: string): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { code } });
    if (!row) throw new NotFoundException(`power circuit ${code} 不存在`);
    await this.assertCanReadDomain(row, role);
    return this.toView(row);
  }

  /**
   * 超轻量「按 code 取开关位」（共享回路「最后离开才关」专用）：只读内存快照里的一个布尔，
   * 不做 toView、不解析 adapter、不开 COM 口，约一次 DB 单条查询 + 一个数组下标。
   * 时序器读各自 seq 快照、断路器（如 LED 总闸 BREAKER-LED-1）读 breaker 快照；
   * 回路不存在或快照未就绪时返回 false。
   */
  async switchOnByCode(code: string): Promise<boolean> {
    const row = await this.repo.findOne({
      where: { code },
      select: { id: true, gatewayCode: true, relayChannel: true },
    });
    if (!row) return false;
    if (row.gatewayCode === 'AUDIO-PWR-SEQ-1' && row.relayChannel) {
      return this.seqCache?.channels[row.relayChannel - 1] ?? false;
    }
    if (row.gatewayCode === 'PWR-SEQ55-1' && row.relayChannel) {
      return this.seq55Cache?.channels[row.relayChannel - 1] ?? false;
    }
    return this.breakerCache.get(row.id)?.reading.on ?? false;
  }

  /** 读域校验：非 admin 角色不能查看所属域外的回路详情（直接打 id 也挡）。 */
  private async assertCanReadDomain(row: PowerCircuit, role?: string): Promise<void> {
    const domains = await this.readableDomainsForRole(role);
    if (domains && !domains.includes(row.domainCode)) {
      throw new ForbiddenException(`该回路不在你可访问的区域`);
    }
  }

  /** 写域校验：非 admin 角色不能操作所属域外的开关（资源级，根治跨区误触）。 */
  private async assertCanWriteDomain(row: PowerCircuit, role?: string): Promise<void> {
    const ok = await this.canWriteDomainForRole(role, row.domainCode);
    if (!ok) {
      throw new ForbiddenException(`无权操作该区域的电源开关`);
    }
  }

  async create(dto: PowerCircuitUpsertDto): Promise<PowerCircuitView> {
    this.validate(dto);
    const domainCode = dto.domainCode ?? POWER_DOMAIN.HALL;
    // 兜底：所属分区未登记则自动收录（前端下拉正常不会触发），保证字典完整、不阻断保存。
    await this.ensureFloor(domainCode, dto.floor);
    const dup = await this.repo.findOne({ where: { code: dto.code } });
    if (dup) throw new ConflictException(`circuit code 已存在: ${dto.code}`);
    const row = this.repo.create({
      code: dto.code,
      name: dto.name,
      floor: dto.floor,
      domainCode,
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
      ...(dto.domainCode !== undefined && { domainCode: dto.domainCode }),
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
    await this.ensureFloor(row.domainCode, row.floor);
    const saved = await this.repo.save(row);
    return this.toView(saved);
  }

  async remove(id: number): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) return;
    await this.repo.delete({ id });
  }

  // ============ 电源域（Domain）管理；仅 admin（controller 用 @ModuleAccess('zones')） ============

  async listDomains(opts: { includeDisabled?: boolean } = {}): Promise<PowerDomainView[]> {
    const rows = await this.domainRepo.find({
      where: opts.includeDisabled ? {} : { enabled: true },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    return Promise.all(rows.map((d) => this.domainToView(d)));
  }

  async createDomain(dto: PowerDomainUpsertDto): Promise<PowerDomainView> {
    const code = dto.code?.trim();
    if (!code) throw new ConflictException('域 code 必填');
    if (!/^[a-z0-9-]+$/.test(code)) throw new ConflictException('域 code 仅允许小写字母、数字与连字符');
    const dup = await this.domainRepo.findOne({ where: { code } });
    if (dup) throw new ConflictException(`域 code 已存在: ${code}`);
    const row = this.domainRepo.create({
      code,
      name: dto.name?.trim() || code,
      sortOrder: dto.sortOrder ?? 100,
      description: dto.description ?? null,
      enabled: dto.enabled ?? true,
    });
    return this.domainToView(await this.domainRepo.save(row));
  }

  async updateDomain(id: number, dto: Partial<PowerDomainUpsertDto>): Promise<PowerDomainView> {
    const row = await this.domainRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power domain #${id} 不存在`);
    if (dto.code !== undefined && dto.code.trim() !== row.code) {
      const code = dto.code.trim();
      if (!/^[a-z0-9-]+$/.test(code)) throw new ConflictException('域 code 仅允许小写字母、数字与连字符');
      const dup = await this.domainRepo.findOne({ where: { code } });
      if (dup) throw new ConflictException(`域 code 已存在: ${code}`);
      row.code = code;
    }
    if (dto.name !== undefined) row.name = dto.name;
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.description !== undefined) row.description = dto.description;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.domainToView(await this.domainRepo.save(row));
  }

  async removeDomain(id: number): Promise<void> {
    const row = await this.domainRepo.findOne({ where: { id } });
    if (!row) return;
    if (row.code === POWER_DOMAIN.HALL || row.code === POWER_DOMAIN.PARK) {
      throw new ConflictException('内置域（展厅/园区）不可删除，可禁用');
    }
    const used = await this.repo.count({ where: { domainCode: row.code } });
    if (used > 0) throw new ConflictException(`该域下仍有 ${used} 条回路，请先改挂其他域再删除`);
    await this.domainRepo.delete({ id });
  }

  private async domainToView(d: PowerDomain): Promise<PowerDomainView> {
    const circuitCount = await this.repo.count({ where: { domainCode: d.code } });
    return {
      id: d.id,
      code: d.code,
      name: d.name,
      sortOrder: d.sortOrder,
      description: d.description,
      enabled: d.enabled,
      circuitCount,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
    };
  }

  // ============ 电源分区（Floor）管理；写仅 admin（controller 用 @ModuleAccess('zones')） ============

  /** 前台/下拉用：默认只返回启用分区，可按域过滤。 */
  async listFloors(opts: { domainCode?: string; includeDisabled?: boolean } = {}): Promise<PowerFloorView[]> {
    const where: Record<string, unknown> = {};
    if (opts.domainCode) where.domainCode = opts.domainCode;
    if (!opts.includeDisabled) where.enabled = true;
    const rows = await this.floorRepo.find({
      where,
      order: { domainCode: 'ASC', sortOrder: 'ASC', id: 'ASC' },
    });
    return Promise.all(rows.map((f) => this.floorToView(f)));
  }

  /**
   * 后台管理用：字典 ∪ 回路实际 floor 的并集。
   * 字典里没有但回路里出现的分区以 registered=false 返回（“未登记·可收录”），绝不丢任何一路。
   */
  async listFloorsForAdmin(opts: { domainCode?: string } = {}): Promise<PowerFloorView[]> {
    const dict = await this.floorRepo.find({
      where: opts.domainCode ? { domainCode: opts.domainCode } : {},
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
    const circuits = await this.repo.find({
      select: { domainCode: true, floor: true },
      where: opts.domainCode ? { domainCode: opts.domainCode } : {},
    });
    const known = new Set(dict.map((f) => `${f.domainCode}::${f.code}`));
    const seenOrphan = new Set<string>();
    const orphans: PowerFloor[] = [];
    for (const c of circuits) {
      const key = `${c.domainCode}::${c.floor}`;
      if (!c.floor || known.has(key) || seenOrphan.has(key)) continue;
      seenOrphan.add(key);
      const stub = new PowerFloor();
      stub.id = 0;
      stub.domainCode = c.domainCode;
      stub.code = c.floor;
      stub.name = c.floor;
      stub.sortOrder = 9999;
      stub.enabled = false;
      orphans.push(stub);
    }
    const all = [...dict, ...orphans];
    all.sort((a, b) =>
      a.domainCode === b.domainCode
        ? a.sortOrder - b.sortOrder
        : a.domainCode < b.domainCode
          ? -1
          : 1,
    );
    return Promise.all(all.map((f) => this.floorToView(f, f.id !== 0)));
  }

  async createFloor(dto: PowerFloorUpsertDto): Promise<PowerFloorView> {
    const domainCode = dto.domainCode?.trim();
    if (!domainCode) throw new ConflictException('所属区域 code 必填');
    const domain = await this.domainRepo.findOne({ where: { code: domainCode } });
    if (!domain) throw new ConflictException(`所属区域不存在: ${domainCode}`);
    const name = dto.name?.trim();
    if (!name) throw new ConflictException('分区名称必填');
    await this.assertFloorNameUnique(domainCode, name);
    let code = dto.code?.trim();
    if (code) {
      // 收录孤儿：沿用回路里已有的 floor 值（可能是中文），不做 kebab 限制。
      const dup = await this.floorRepo.findOne({ where: { domainCode, code } });
      if (dup) throw new ConflictException(`该分区已登记: ${code}`);
    } else {
      code = await this.generateFloorCode(domainCode);
    }
    const row = this.floorRepo.create({
      domainCode,
      code,
      name,
      sortOrder: dto.sortOrder ?? 100,
      enabled: dto.enabled ?? true,
    });
    return this.floorToView(await this.floorRepo.save(row));
  }

  async updateFloor(id: number, dto: Partial<PowerFloorUpsertDto>): Promise<PowerFloorView> {
    const row = await this.floorRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power floor #${id} 不存在`);
    // code 是稳定标识、回路引用它，禁止修改（改了会导致整层失联）；只改中文名/排序/启用。
    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (!name) throw new ConflictException('分区名称必填');
      await this.assertFloorNameUnique(row.domainCode, name, id);
      row.name = name;
    }
    if (dto.sortOrder !== undefined) row.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) row.enabled = dto.enabled;
    return this.floorToView(await this.floorRepo.save(row));
  }

  async removeFloor(id: number): Promise<void> {
    const row = await this.floorRepo.findOne({ where: { id } });
    if (!row) return;
    const used = await this.repo.count({ where: { domainCode: row.domainCode, floor: row.code } });
    if (used > 0) {
      throw new ConflictException(`该分区下仍有 ${used} 条回路，请先改挂到其他分区再删除`);
    }
    await this.floorRepo.delete({ id });
  }

  /** 回路保存兜底：所属 (域,分区) 未登记则自动收录（name=code），保证字典完整、不阻断。 */
  private async ensureFloor(domainCode: string, floorCode: string): Promise<void> {
    const code = floorCode?.trim();
    if (!code) return;
    const exists = await this.floorRepo.findOne({ where: { domainCode, code } });
    if (exists) return;
    const row = this.floorRepo.create({ domainCode, code, name: code, sortOrder: 100, enabled: true });
    try {
      await this.floorRepo.save(row);
    } catch {
      // 并发下唯一索引冲突 = 已被另一请求收录，忽略。
    }
  }

  private async assertFloorNameUnique(domainCode: string, name: string, excludeId?: number): Promise<void> {
    const dup = await this.floorRepo.findOne({ where: { domainCode, name } });
    if (dup && dup.id !== excludeId) throw new ConflictException(`同区域下分区名称已存在: ${name}`);
  }

  /** 生成域内唯一的短 code（f + base36 时间戳 + 随机，≤16 字符以匹配回路 floor 列）。 */
  private async generateFloorCode(domainCode: string): Promise<string> {
    for (let i = 0; i < 5; i++) {
      const code = ('f' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)).slice(0, 16);
      const exists = await this.floorRepo.findOne({ where: { domainCode, code } });
      if (!exists) return code;
    }
    throw new ConflictException('分区编号生成冲突，请重试');
  }

  private async floorToView(f: PowerFloor, registered = true): Promise<PowerFloorView> {
    const circuitCount = await this.repo.count({
      where: { domainCode: f.domainCode, floor: f.code },
    });
    return {
      id: f.id,
      domainCode: f.domainCode,
      code: f.code,
      name: f.name,
      sortOrder: f.sortOrder,
      enabled: f.enabled,
      circuitCount,
      registered,
      createdAt: f.createdAt,
      updatedAt: f.updatedAt,
    };
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
   * HTTP 单路通断（带角色 × 域资源级校验）—— 控制器 on/off 走这里。
   * 方法级 @WriteRoles 只判断"哪个角色能调电源控制"，不查具体回路；这里查到
   * 回路后按其 domainCode 再校验一次，operator 对园区、config 对展厅都会 403。
   * 定时任务（power-schedules）到点系统自动执行，无 HTTP actor，仍走 turnOn/
   * turnOff 不受此限（规则本身由有权限角色配置，且不应自动执行时被拦）。
   */
  async turnOnForRole(id: number, role: string): Promise<PowerCircuitView> {
    await this.assertCircuitWriteDomain(id, role);
    return this.switchCircuit(id, true);
  }

  async turnOffForRole(id: number, role: string): Promise<PowerCircuitView> {
    await this.assertCircuitWriteDomain(id, role);
    return this.switchCircuit(id, false);
  }

  private async assertCircuitWriteDomain(id: number, role: string): Promise<void> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    await this.assertCanWriteDomain(row, role);
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
      // 第二台时序器 (55…AA 协议, COM4): 单路 F0/F1 立即动作, 乐观置位快照让 UI
      // 立即稳定; 不在请求路径读真机, 数秒后由后台 collectSequencer 以真机为准校正。
      if (!this.seq55) throw new ConflictException('seq55 时序器适配器未装载');
      const r = await this.seq55.setChannel(row.relayChannel as number, on);
      if (!r.ok) throw new ConflictException(`时序器下发失败: ${r.error ?? '未知错误'}`);
      const seq55ChIdx = (row.relayChannel ?? 0) - 1;
      if (!this.seq55Cache) this.seq55Cache = { at: Date.now(), channels: new Array(8).fill(false) };
      if (seq55ChIdx >= 0 && seq55ChIdx < this.seq55Cache.channels.length) {
        this.seq55Cache.channels[seq55ChIdx] = on;
        this.seq55Cache.at = Date.now();
      }
      this.scheduleSeqRefresh(4000);
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
  ): Promise<
    EpaBreakerAdapter | EpaMqttBreakerAdapter | HperforApiAdapter | EwelinkApiAdapter | null
  > {
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
    if (hw.category === 'power-breaker-ewelink') {
      if (!this.ewelinkBreaker) throw new ConflictException('易微联云开关适配器未装载');
      return this.ewelinkBreaker;
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
    breakerAdapter:
      | EpaBreakerAdapter
      | EpaMqttBreakerAdapter
      | HperforApiAdapter
      | EwelinkApiAdapter,
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
        if (adapter instanceof HperforApiAdapter || adapter instanceof EwelinkApiAdapter) {
          parallel.push(row); // 云 HTTP 设备可并行
        } else serial.push(row); // 485 / MQTT: 保守串行, 避免共享总线冲突
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
  async breakerMeasurements(id: number, role?: string): Promise<BreakerMeasurements> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    await this.assertCanReadDomain(row, role);
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
   * 后台采集时序器全状态: 各发一次读状态帧 (EPO 0xac / SEQ55 FA, 一帧带全部 8 路)
   * 写**各自**的快照。只在后台定时/操作后调度时运行, 永不在页面请求路径;
   * 两台串口独立 (EPO=COM1@19200, SEQ55=COM4@9600), 这里串行 await、各自适配器
   * 内部有短连接/命令锁。任何一台读失败都保留其上一次好值, 不覆盖、不影响另一台。
   */
  private async collectSequencer(): Promise<void> {
    if (this.seqCollecting) return;
    this.seqCollecting = true;
    try {
      // 第一台: 得胜 EPO-802P (5A5A5A, COM1)
      // 窗口期内合成逐路快照由 runSeqWindow 独占维护, 定时采集跳过、不覆盖。
      if (this.seqWindowCategory !== 'audio-power') {
        try {
          const r = await this.epo.readStatus();
          if (r.ok && r.data?.channels) {
            this.seqCache = { at: Date.now(), channels: r.data.channels };
          } else {
            this.logger.warn(`EPO 时序器读状态失败: ${r.error ?? '无数据'}`, {
              context: 'PowerCircuitsService',
            });
          }
        } catch (err) {
          this.logger.warn(`EPO 时序器采集异常: ${(err as Error).message}`, {
            context: 'PowerCircuitsService',
          });
        }
      }
      // 第二台: SEQ55 (55…AA, COM4)。适配器未注入(单测桩)/未配置硬件时跳过。
      // 同样: SEQ55 窗口期内不覆盖（虽 SEQ55 用真实回读，避免与窗口期采集竞争串口）。
      if (this.seq55 && this.seqWindowCategory !== 'power-seq55') {
        try {
          const s = await this.seq55.readStatus();
          if (s.ok && s.data?.channels) {
            this.seq55Cache = { at: Date.now(), channels: s.data.channels };
          } else {
            this.logger.warn(`SEQ55 时序器读状态失败: ${s.error ?? '无数据'}`, {
              context: 'PowerCircuitsService',
            });
          }
        } catch (err) {
          this.logger.warn(`SEQ55 时序器采集异常: ${(err as Error).message}`, {
            context: 'PowerCircuitsService',
          });
        }
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
   * 时序动作窗口期 —— seqAll 下发后, 设备按各路设定延时(开机约 1/3/…/15s、
   * 关机倒序)逐路通断。窗口期内对该台**高频 readStatus**(一帧带全部 8 路), 每轮
   * 与上一次逐路比对, 哪一路翻转就 WS 广播哪一路, 前端据此逐路点亮, 与硬件同步。
   * 不阻塞下发请求; 末轮再采一次最终态, 保证最终状态准确。EPO / SEQ55 共用同一
   * 窗口口径(仅底层 readStatus 不同), 两台逐路回显体验一致。
   */
  private readonly SEQ_WINDOW_INTERVAL_MS = 1_500;
  private readonly SEQ_WINDOW_TOTAL_MS = 19_500;
  /**
   * EPO-802P 各路**固定**时序延时(真机 ac 回读钉死, 见 epo802p-protocol.ts):
   * 开机 CH1→CH8 = 1,3,5,…,15s; 关机倒序 = 15,13,…,1s。
   * 真机实测 EPO 串口状态字节在 b3 命令后**立即回目标态**(读不到物理逐路进度),
   * 窗口期用这组固定延时合成逐路 bitmap(与物理逐路同步), 末轮再用真实回读校正。
   */
  private readonly EPO_DELAY_ON_SECONDS = [1, 3, 5, 7, 9, 11, 13, 15];
  private readonly EPO_DELAY_OFF_SECONDS = [15, 13, 11, 9, 7, 5, 3, 1];
  private async runSeqWindow(
    gatewayCode: string,
    on: boolean,
    initChannels?: boolean[] | null,
  ): Promise<void> {
    const rows = await this.repo.find({ where: { gatewayCode, enabled: true } });
    if (rows.length === 0) return;
    const hw = await this.hwRepo.findOne({ where: { code: gatewayCode } });
    const category = hw?.category;
    const rounds = Math.round(this.SEQ_WINDOW_TOTAL_MS / this.SEQ_WINDOW_INTERVAL_MS);
    let prevChannels: boolean[] | null = null;
    const startedAt = Date.now();
    // 窗口期独占该台逐路快照: 置标志, 阻止 collectSequencer 定时采集读真实全目标覆盖
    this.seqWindowCategory = category ?? null;
    try {
      for (let i = 0; i < rounds; i += 1) {
        await new Promise<void>((resolve) => {
          const t = setTimeout(resolve, this.SEQ_WINDOW_INTERVAL_MS);
          t.unref?.();
        });
        const real = await this.readSeqChannels(category);
        if (!real) continue;
        // EPO 状态字节=命令目标态(立即全翻转)、读不到物理逐路; 用固定延时合成逐路,
        // 末轮用真实回读做最终校正。SEQ55 状态字节=物理实际通路, 直接用真实回读。
        const isLast = i === rounds - 1;
        const channels =
          category === 'audio-power' && !isLast
            ? this.epoSyntheticChannels(on, (Date.now() - startedAt) / 1000, initChannels)
            : real;
        if (category === 'audio-power') this.seqCache = { at: Date.now(), channels };
        else if (category === 'power-seq55') this.seq55Cache = { at: Date.now(), channels };
        this.publishSeqChannelChanges(rows, channels, prevChannels);
        prevChannels = channels;
      }
    } finally {
      this.seqWindowCategory = null;
    }
  }

  /**
   * EPO 窗口期逐路合成 —— 按厂家固定延时, 已到该路过期时刻就翻转:
   * 开机初始全关、到点开; 关机初始全开、到点关。与设备物理逐路通断同步(误差≤1s),
   * 让 EPO 与 SEQ55 一样逐路回显; 末轮用真实回读校正。
   * 若 setAll 前读到真实初始态（现场可能手动开了某路），以它为准, 该路不会被错误闪关。
   */
  private epoSyntheticChannels(
    on: boolean,
    elapsedSec: number,
    initChannels?: boolean[] | null,
  ): boolean[] {
    const delays = on ? this.EPO_DELAY_ON_SECONDS : this.EPO_DELAY_OFF_SECONDS;
    const channels: boolean[] = [];
    for (let n = 0; n < 8; n += 1) {
      // 标准初始态: 开机全关(false) / 关机全开(true)；读到真实初始态则覆盖
      const init = initChannels ? initChannels[n] : !on;
      const reached = elapsedSec >= delays[n];
      // 开机: 初始已开 或 已到开机延时 → 开；关机: 初始仍开 且 未到关延时 → 开
      channels.push(on ? init || reached : init && !reached);
    }
    return channels;
  }

  /** 按设备类型读一台时序器的 8 路实时位图; 读失败返回 null(保留上一次好值)。 */
  private async readSeqChannels(category?: string): Promise<boolean[] | null> {
    try {
      if (category === 'audio-power') {
        const r = await this.epo.readStatus();
        return r.ok && r.data?.channels ? r.data.channels : null;
      }
      if (category === 'power-seq55') {
        if (!this.seq55) return null;
        const r = await this.seq55.readStatus();
        return r.ok && r.data?.channels ? r.data.channels : null;
      }
    } catch (err) {
      this.logger.warn(`时序窗口期读状态异常: ${(err as Error).message}`, {
        context: 'PowerCircuitsService',
      });
    }
    return null;
  }

  /** 窗口期内逐路比对: 哪一路相对上一次翻转, 就 WS 广播那一路 (首轮同步全部当前态)。 */
  private publishSeqChannelChanges(
    rows: PowerCircuit[],
    channels: boolean[],
    prev: boolean[] | null,
  ): void {
    if (!this.bus) return;
    for (const row of rows) {
      const ch = (row.relayChannel ?? 0) - 1;
      if (ch < 0 || ch >= channels.length) continue;
      const on = channels[ch];
      if (prev !== null && prev[ch] === on) continue; // 该路未变化
      this.publishReading(row, this.readingFromSeqCache(row, { at: Date.now(), channels }));
    }
  }

  /**
   * 时序器回路读数 — 只读后台快照、不开串口; 快照未就绪时 on=false, 不让电源页崩。
   * 时序器不是电表, 电流/电压/功率/电量恒 0。
   */
  private readingFromSeqCache(
    row: PowerCircuit,
    cache: { at: number; channels: boolean[] } | null,
  ): PowerReading {
    const ch = (row.relayChannel ?? 0) - 1;
    return {
      on: cache?.channels[ch] ?? false,
      current: 0,
      voltage: 0,
      power: 0,
      powerFactor: 0,
      energy: 0,
      lastReadAt: cache ? new Date(cache.at).toISOString() : new Date().toISOString(),
    };
  }

  /** 第一台 EPO 时序器回路读数。 */
  private seqReading(row: PowerCircuit): PowerReading {
    return this.readingFromSeqCache(row, this.seqCache);
  }

  /** 第二台 SEQ55 时序器回路读数。 */
  private seq55Reading(row: PowerCircuit): PowerReading {
    return this.readingFromSeqCache(row, this.seq55Cache);
  }

  /**
   * 单台时序器**时序**全开/全关 —— 必须显式指定 gatewayCode, 只动作这一台,
   * 不允许一个按钮同时控制两台时序器 (业主 2026-10-18 明确要求两台各自独立开关)。
   *
   * 第一台 EPO 走 b3 (设备按各路延时依次动作, 实测 开 1,3,..15s / 关 15,13,..1s);
   * 第二台 SEQ55 走 0D 顺序时序 (55…AA 协议)。两者都保护后级功放。
   * 整台时序动作需要时间, 不做整台乐观置位, 由后台 10s 采集逐路点亮真实状态。
   */
  async sequencerAll(on: boolean, gatewayCode?: string | null): Promise<void> {
    const code = (gatewayCode ?? '').trim();
    if (!code) {
      throw new ConflictException('请指定要操作的时序器设备');
    }
    const hw = await this.hwRepo.findOne({ where: { code } });
    if (!hw || !hw.enabled) {
      throw new NotFoundException(`时序器设备 ${code} 不存在或已禁用`);
    }
    if (hw.category === 'audio-power') {
      // setAll 前先读一次真实初始态（现场可能手动开了某路），供窗口期合成从该态出发、
      // 不把已开路错误闪关；读失败则用标准极端态（开机全关 / 关机全开）。
      let initChannels: boolean[] | null = null;
      try {
        const init = await this.epo.readStatus();
        if (init.ok && init.data?.channels) initChannels = init.data.channels;
      } catch {
        initChannels = null;
      }
      const r = await this.epo.setAll(on);
      if (!r.ok) throw new ConflictException(`时序器${on ? '开' : '关'}机失败: ${r.error ?? '未知'}`);
      // 八路按 1..15s 延时依次动作; 窗口期高频 readStatus, 逐路变化即 WS 广播(前端逐路点亮)
      void this.runSeqWindow(code, on, initChannels);
      return;
    }
    if (hw.category === 'power-seq55') {
      if (!this.seq55) throw new ConflictException('SEQ55 时序器适配器未装载');
      const r = await this.seq55.setAllSequential(on); // 0D 设备内部顺序时序
      if (!r.ok) throw new ConflictException(`时序器${on ? '开' : '关'}机失败: ${r.error ?? '未知'}`);
      // 与第一台 EPO 完全一致的窗口期采集/广播口径, 两台逐路回显体验相同
      void this.runSeqWindow(code, on);
      return;
    }
    throw new ConflictException(`设备 ${code} 不是电源时序器, 无法时序开关机`);
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

  private async toView(
    row: PowerCircuit,
    nameMap?: Map<string, string>,
    floorMap?: Map<string, string>,
    hwNameMap?: Map<string, string>,
  ): Promise<PowerCircuitView> {
    const domainName = nameMap?.get(row.domainCode) ?? null;
    const floorName = floorMap?.get(`${row.domainCode}::${row.floor}`) ?? row.floor;
    const gatewayName = row.gatewayCode ? (hwNameMap?.get(row.gatewayCode) ?? null) : null;
    const breakerAdapter = await this.resolveBreakerAdapter(row);
    const isBreaker = breakerAdapter !== null;
    // 智能断路器回路: 读真机 (电压/电流/功率/电量都是实测), 不用 mock 的模拟值
    if (breakerAdapter) {
      return {
        ...this.baseView(row, domainName, floorName, gatewayName),
        isBreaker,
        reading: this.snapshotBreakerReading(row), // 读快照, 不等待外部 I/O
      };
    }
    // 第二台时序器 (SEQ55, 55…AA): 开关状态读它自己的后台快照 (FA 一帧带 8 路)
    if (await this.isSeq55Circuit(row)) {
      return {
        ...this.baseView(row, domainName, floorName, gatewayName),
        isBreaker,
        reading: this.seq55Reading(row),
      };
    }
    // 第一台时序器 (EPO-802P): 开关状态读后台快照 (0xac 一帧带全部 8 路), 电量指标没有 → 0
    if (await this.isSequencerCircuit(row)) {
      return {
        ...this.baseView(row, domainName, floorName, gatewayName),
        isBreaker,
        reading: this.seqReading(row),
      };
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
    return { ...this.baseView(row, domainName, floorName, gatewayName), isBreaker, reading };
  }

  /** 单相 MQTT 设备只填 A 相；三相设备取三相平均。 */
  private averagePresentPhases(values: [number, number, number]): number {
    const present = values.filter((value) => Number.isFinite(value) && value > 0);
    if (present.length === 0) return 0;
    return present.reduce((sum, value) => sum + value, 0) / present.length;
  }

  /** 域 code → 中文名（一次加载，供 toView 批量填充，避免逐条查询）。 */
  private async domainNameMap(): Promise<Map<string, string>> {
    const domains = await this.domainRepo.find({ select: { code: true, name: true } });
    return new Map(domains.map((d) => [d.code, d.name]));
  }

  /** 分区 `${domainCode}::${code}` → 中文名（一次加载，供 toView 批量填充）。 */
  private async floorNameMap(): Promise<Map<string, string>> {
    const floors = await this.floorRepo.find({ select: { domainCode: true, code: true, name: true } });
    return new Map(floors.map((f) => [`${f.domainCode}::${f.code}`, f.name]));
  }

  /** 硬件 code → 中文名（一次加载，供 toView 批量填充 gatewayName，电源页按设备分组用）。 */
  private async hwNameMap(): Promise<Map<string, string>> {
    const hw = await this.hwRepo.find({ select: { code: true, name: true } });
    return new Map(hw.map((h) => [h.code, h.name]));
  }

  /** 行字段 → view (不含 reading / isBreaker, 两条读数路径共用) */
  private baseView(
    row: PowerCircuit,
    domainName?: string | null,
    floorName?: string | null,
    gatewayName?: string | null,
  ): Omit<PowerCircuitView, 'reading' | 'isBreaker'> {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      floor: row.floor,
      floorName: floorName ?? row.floor,
      domainCode: row.domainCode,
      domainName: domainName ?? null,
      category: row.category,
      gatewayCode: row.gatewayCode,
      gatewayName: gatewayName ?? null,
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
