import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { CronJob } from 'cron';
import { Like, Repository } from 'typeorm';
import { Logger } from 'winston';
import { SchedulerTask } from '../../entities/scheduler-task.entity';
import { SceneEngineService } from '../../services/scene-engine.service';
import { OperationLogService } from '../logs/operation-log.service';
import {
  CreateSchedulerTaskDto,
  QuerySchedulerTaskDto,
  UpdateSchedulerTaskDto,
} from './dto/scheduler.dto';
import { PagedResult } from '../devices/devices.service';

@Injectable()
export class SchedulerService implements OnApplicationBootstrap, OnModuleDestroy {
  private jobs = new Map<number, CronJob>();

  constructor(
    @InjectRepository(SchedulerTask) private readonly repo: Repository<SchedulerTask>,
    private readonly engine: SceneEngineService,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const tasks = await this.repo.find();
    for (const t of tasks) {
      if (t.enabled) this.spawn(t);
    }
    this.logger.info(`Scheduler ready (${tasks.filter((t) => t.enabled).length} enabled)`, {
      context: 'SchedulerService',
    });
  }

  onModuleDestroy(): void {
    for (const j of this.jobs.values()) {
      try {
        j.stop();
      } catch {
        // ignore
      }
    }
    this.jobs.clear();
  }

  async findAll(q: QuerySchedulerTaskDto): Promise<PagedResult<SchedulerTask>> {
    const page = q.page ?? 1;
    const pageSize = q.pageSize ?? 50;
    const where: Record<string, unknown> = {};
    if (q.enabled !== undefined) where.enabled = q.enabled;
    if (q.keyword) where.name = Like(`%${q.keyword}%`);

    const [list, total] = await this.repo.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<SchedulerTask> {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException(`定时任务不存在: id=${id}`);
    return t;
  }

  async create(dto: CreateSchedulerTaskDto): Promise<SchedulerTask> {
    const exists = await this.repo.findOne({ where: { name: dto.name } });
    if (exists) throw new ConflictException(`任务名称已存在: ${dto.name}`);
    this.assertCron(dto.cron);

    const entity = this.repo.create({
      name: dto.name,
      description: dto.description ?? null,
      cron: dto.cron,
      sceneCode: dto.sceneCode,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.repo.save(entity);
    if (saved.enabled) this.spawn(saved);
    await this.logService.record({
      operator: 'admin',
      action: 'scheduler.create',
      targetType: 'scheduler',
      targetId: String(saved.id),
      message: `${saved.name} → ${saved.sceneCode} (${saved.cron})`,
    });
    return saved;
  }

  async update(id: number, dto: UpdateSchedulerTaskDto): Promise<SchedulerTask> {
    const task = await this.findOne(id);

    if (dto.name && dto.name !== task.name) {
      const dup = await this.repo.findOne({ where: { name: dto.name } });
      if (dup && dup.id !== id) throw new ConflictException(`任务名称已存在: ${dto.name}`);
    }
    if (dto.cron) this.assertCron(dto.cron);

    Object.assign(task, dto);
    const saved = await this.repo.save(task);
    this.respawn(saved);
    await this.logService.record({
      operator: 'admin',
      action: 'scheduler.update',
      targetType: 'scheduler',
      targetId: String(id),
      message: `${saved.name} enabled=${saved.enabled}`,
    });
    return saved;
  }

  async remove(id: number): Promise<void> {
    const task = await this.findOne(id);
    this.kill(id);
    await this.repo.remove(task);
    await this.logService.record({
      operator: 'admin',
      action: 'scheduler.delete',
      targetType: 'scheduler',
      targetId: String(id),
      message: task.name,
    });
  }

  /**
   * 立即触发一次 (调试用), 不影响 cron 计划
   */
  async runNow(id: number): Promise<void> {
    const task = await this.findOne(id);
    await this.fire(task);
  }

  private assertCron(expr: string): void {
    try {
      // CronJob 接受表达式或解析失败抛错
      new CronJob(expr, () => undefined, null, false);
    } catch (err) {
      throw new ConflictException(`cron 表达式无效: ${(err as Error).message}`);
    }
  }

  private spawn(task: SchedulerTask): void {
    this.kill(task.id);
    try {
      const job = new CronJob(
        task.cron,
        () => void this.fire(task),
        null,
        true,
        'Asia/Shanghai',
      );
      this.jobs.set(task.id, job);
      this.logger.info(
        `Scheduled: #${task.id} ${task.name} cron=${task.cron} -> ${task.sceneCode}`,
        { context: 'SchedulerService' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule #${task.id} ${task.name}: ${(err as Error).message}`,
        { context: 'SchedulerService' },
      );
    }
  }

  private respawn(task: SchedulerTask): void {
    this.kill(task.id);
    if (task.enabled) this.spawn(task);
  }

  private kill(id: number): void {
    const j = this.jobs.get(id);
    if (j) {
      try {
        j.stop();
      } catch {
        // ignore
      }
      this.jobs.delete(id);
    }
  }

  private async fire(task: SchedulerTask): Promise<void> {
    let status: 'success' | 'failure' = 'success';
    let message = '';
    try {
      const exec = await this.engine.execute(task.sceneCode, `scheduler:${task.name}`);
      message = `executionId=${exec.executionId}`;
      this.logger.info(
        `Scheduler fired: #${task.id} ${task.name} -> scene ${task.sceneCode} ${message}`,
        { context: 'SchedulerService' },
      );
    } catch (err) {
      status = 'failure';
      message = (err as Error).message;
      this.logger.warn(
        `Scheduler #${task.id} ${task.name} failed: ${message}`,
        { context: 'SchedulerService' },
      );
    }
    await this.repo.update(task.id, {
      lastRunAt: new Date(),
      lastRunStatus: status,
      lastRunMessage: message,
    });
    await this.logService.record({
      operator: `scheduler:${task.name}`,
      action: 'scheduler.fire',
      targetType: 'scheduler',
      targetId: String(task.id),
      result: status,
      message,
    });
  }
}
