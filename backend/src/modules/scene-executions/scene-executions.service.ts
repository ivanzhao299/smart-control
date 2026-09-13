import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, Repository } from 'typeorm';
import {
  ExecutionStatusValue,
  SceneExecution,
  TriggerType,
} from '../../entities/scene-execution.entity';
import { QueryExecutionDto } from './dto/query-execution.dto';
import { PagedResult } from '../devices/devices.service';

@Injectable()
export class SceneExecutionsService {
  constructor(
    @InjectRepository(SceneExecution)
    private readonly repo: Repository<SceneExecution>,
  ) {}

  async findAll(q: QueryExecutionDto): Promise<PagedResult<SceneExecution>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: FindOptionsWhere<SceneExecution> = {};
    if (q.sceneCode) where.sceneCode = q.sceneCode;
    if (q.status) where.status = q.status as ExecutionStatusValue;
    if (q.triggerType) where.triggerType = q.triggerType as TriggerType;
    if (q.startTime && q.endTime) {
      where.createdAt = Between(new Date(q.startTime), new Date(q.endTime));
    }

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'DESC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<SceneExecution> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException(`场景执行记录不存在: id=${id}`);
    return r;
  }

  async findByExecutionId(executionId: string): Promise<SceneExecution> {
    const r = await this.repo.findOne({ where: { executionId } });
    if (!r) throw new NotFoundException(`场景执行记录不存在: ${executionId}`);
    return r;
  }
}
