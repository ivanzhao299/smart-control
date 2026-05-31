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
  { code: '1f-led', name: '一层 LED 大屏', floor: '1F', category: 'led',
    gatewayCode: 'RELAY-1F-1', relayChannel: 4,
    ratedVoltage: 220, ratedCurrent: 20, ratedPower: 3500,
    sortOrder: 30, icon: 'MonitorPlay' },
  { code: '2f-lighting', name: '二层照明回路', floor: '2F', category: 'lighting',
    gatewayCode: 'RELAY-2F-1', relayChannel: 1,
    ratedVoltage: 220, ratedCurrent: 16, ratedPower: 1800,
    sortOrder: 10, icon: 'Lightbulb' },
  { code: '2f-hvac', name: '二层空调回路', floor: '2F', category: 'hvac',
    gatewayCode: 'RELAY-2F-1', relayChannel: 2,
    ratedVoltage: 380, ratedCurrent: 40, ratedPower: 12000,
    sortOrder: 20, icon: 'Snowflake' },
];

@Injectable()
export class PowerCircuitsService implements OnModuleInit {
  constructor(
    @InjectRepository(PowerCircuit) private readonly repo: Repository<PowerCircuit>,
    private readonly adapter: PowerAdapter,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

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
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    if (!row.enabled) throw new ConflictException(`circuit ${row.name} 已禁用`);
    await this.adapter.circuitTurnOn(id);
    return this.toView(row);
  }

  async turnOff(id: number): Promise<PowerCircuitView> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`power circuit #${id} 不存在`);
    if (!row.enabled) throw new ConflictException(`circuit ${row.name} 已禁用`);
    await this.adapter.circuitTurnOff(id);
    return this.toView(row);
  }

  // ============ 内部 ============

  private validate(dto: PowerCircuitUpsertDto): void {
    if (!dto.code) throw new ConflictException('code 必填');
    if (!dto.name) throw new ConflictException('name 必填');
    if (!dto.floor) throw new ConflictException('floor 必填');
  }

  private async toView(row: PowerCircuit): Promise<PowerCircuitView> {
    const result = await this.adapter.circuitReadStatus(row.id, {
      voltage: row.ratedVoltage,
      current: row.ratedCurrent,
      power: row.ratedPower,
    });
    const reading: PowerReading = result.ok && result.data
      ? result.data
      : { on: false, current: 0, voltage: 0, power: 0, powerFactor: 0, energy: 0, lastReadAt: new Date().toISOString() };
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
      reading,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
