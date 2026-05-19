import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { FindOptionsWhere, Like, Repository } from 'typeorm';
import { Logger } from 'winston';
import {
  UatCategory,
  UatRecord,
  UatStatus,
} from '../../entities/uat-record.entity';
import { ControlBus } from '../../services/control-bus';
import {
  CreateUatDto,
  QueryUatDto,
  TransitionUatDto,
  UpdateUatDto,
} from './dto/uat.dto';
import { PagedResult } from '../devices/devices.service';

export interface UatSummary {
  total: number;
  passed: number;
  failed: number;
  needAdjustment: number;
  pending: number;
  passRate: number;
  byCategory: Record<UatCategory, { total: number; passed: number; failed: number; needAdjustment: number; pending: number }>;
}

@Injectable()
export class UatService {
  constructor(
    @InjectRepository(UatRecord) private readonly repo: Repository<UatRecord>,
    private readonly bus: ControlBus,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll(q: QueryUatDto): Promise<PagedResult<UatRecord>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 500;
    const where: FindOptionsWhere<UatRecord> = {};
    if (q.category) where.category = q.category;
    if (q.status) where.status = q.status;
    if (q.keyword) where.itemName = Like(`%${q.keyword}%`);

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { sortOrder: 'ASC', id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<UatRecord> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`UAT 项不存在: id=${id}`);
    return r;
  }

  async create(dto: CreateUatDto): Promise<UatRecord> {
    const exists = await this.repo.findOne({ where: { itemName: dto.itemName } });
    if (exists) throw new ConflictException(`UAT 项已存在: ${dto.itemName}`);
    const entity = this.repo.create({
      itemName: dto.itemName,
      category: dto.category,
      testStep: dto.testStep ?? null,
      expectedResult: dto.expectedResult ?? null,
      actualResult: dto.actualResult ?? null,
      status: dto.status ?? 'pending',
      tester: dto.tester ?? null,
      remark: dto.remark ?? null,
      sortOrder: dto.sortOrder ?? 0,
    });
    const saved = await this.repo.save(entity);
    this.broadcast(saved);
    return saved;
  }

  async update(id: number, dto: UpdateUatDto): Promise<UatRecord> {
    const r = await this.findOne(id);
    Object.assign(r, dto);
    const saved = await this.repo.save(r);
    this.broadcast(saved);
    return saved;
  }

  async remove(id: number): Promise<void> {
    const r = await this.findOne(id);
    await this.repo.remove(r);
  }

  async transition(
    id: number,
    status: UatStatus,
    dto: TransitionUatDto,
  ): Promise<UatRecord> {
    const r = await this.findOne(id);
    r.status = status;
    if (dto.actualResult !== undefined) r.actualResult = dto.actualResult;
    if (dto.tester !== undefined) r.tester = dto.tester;
    if (dto.remark !== undefined) r.remark = dto.remark;
    const saved = await this.repo.save(r);
    this.logger.info(`UAT #${id} ${r.itemName} → ${status} by ${dto.tester ?? '-'}`, {
      context: 'UatService',
    });
    this.broadcast(saved);
    return saved;
  }

  async summary(): Promise<UatSummary> {
    const all = await this.repo.find();
    const total = all.length;
    let passed = 0;
    let failed = 0;
    let needAdjustment = 0;
    let pending = 0;
    const byCategory: UatSummary['byCategory'] = {
      scene: { total: 0, passed: 0, failed: 0, needAdjustment: 0, pending: 0 },
      device: { total: 0, passed: 0, failed: 0, needAdjustment: 0, pending: 0 },
      stability: { total: 0, passed: 0, failed: 0, needAdjustment: 0, pending: 0 },
      other: { total: 0, passed: 0, failed: 0, needAdjustment: 0, pending: 0 },
    };
    for (const r of all) {
      const c = byCategory[r.category];
      c.total += 1;
      switch (r.status) {
        case 'passed': passed += 1; c.passed += 1; break;
        case 'failed': failed += 1; c.failed += 1; break;
        case 'need_adjustment': needAdjustment += 1; c.needAdjustment += 1; break;
        default: pending += 1; c.pending += 1;
      }
    }
    const passRate = total > 0 ? Math.round((passed / total) * 1000) / 10 : 0;
    return { total, passed, failed, needAdjustment, pending, passRate, byCategory };
  }

  private broadcast(r: UatRecord): void {
    try {
      this.bus.publish({
        type: 'uat_updated',
        uatId: r.id,
        status: r.status,
        itemName: r.itemName,
        tester: r.tester ?? undefined,
        at: new Date().toISOString(),
      });
    } catch {
      // ignore
    }
  }
}
