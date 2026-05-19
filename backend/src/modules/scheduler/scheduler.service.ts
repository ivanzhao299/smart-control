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
      if (t.enabled) await this.spawn(t);
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
      code: dto.code ?? null,
      description: dto.description ?? null,
      cron: dto.cron,
      sceneCode: dto.sceneCode,
      enabled: dto.enabled ?? true,
      nextRunAt: this.calcNextRun(dto.cron),
    });
    const saved = await this.repo.save(entity);
    if (saved.enabled) await this.spawn(saved);
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
    if (dto.cron) task.nextRunAt = this.calcNextRun(dto.cron);
    const saved = await this.repo.save(task);
    await this.respawn(saved);
    await this.logService.record({
      operator: 'admin',
      action: 'scheduler.update',
      targetType: 'scheduler',
      targetId: String(id),
      message: `${saved.name} enabled=${saved.enabled}`,
    });
    return saved;
  }

  async setEnabled(id: number, enabled: boolean, operator = 'admin'): Promise<SchedulerTask> {
    const task = await this.findOne(id);
    if (task.enabled === enabled) return task;
    task.enabled = enabled;
    if (enabled) task.nextRunAt = this.calcNextRun(task.cron);
    else task.nextRunAt = null;
    const saved = await this.repo.save(task);
    await this.respawn(saved);
    await this.logService.record({
      operator,
      action: enabled ? 'scheduler.enable' : 'scheduler.disable',
      targetType: 'scheduler',
      targetId: String(id),
      message: saved.name,
    });
    this.logger.info(`Scheduler ${enabled ? 'enabled' : 'disabled'}: #${id} ${saved.name}`, {
      context: 'SchedulerService',
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

  /** 立即触发一次 (调试用), 不影响 cron 计划 */
  async runNow(id: number, operator = 'admin'): Promise<void> {
    const task = await this.findOne(id);
    await this.fire(task, operator, 'runNow');
  }

  private assertCron(expr: string): void {
    try {
      new CronJob(expr, () => undefined, null, false);
    } catch (err) {
      throw new ConflictException(`cron 表达式无效: ${(err as Error).message}`);
    }
  }

  private calcNextRun(expr: string): Date | null {
    try {
      const job = new CronJob(expr, () => undefined, null, false, 'Asia/Shanghai');
      const next = job.nextDate();
      return next ? next.toJSDate() : null;
    } catch {
      return null;
    }
  }

  private async spawn(task: SchedulerTask): Promise<void> {
    this.kill(task.id);
    try {
      const job = new CronJob(
        task.cron,
        () => void this.fire(task, `scheduler:${task.name}`, 'cron'),
        null,
        true,
        'Asia/Shanghai',
      );
      this.jobs.set(task.id, job);
      // 持久化下次执行时间
      const next = job.nextDate()?.toJSDate() ?? null;
      if (next && (!task.nextRunAt || task.nextRunAt.getTime() !== next.getTime())) {
        await this.repo.update(task.id, { nextRunAt: next });
        task.nextRunAt = next;
      }
      this.logger.info(
        `Scheduled: #${task.id} ${task.name} cron=${task.cron} -> ${task.sceneCode} next=${next?.toISOString() ?? 'unknown'}`,
        { context: 'SchedulerService' },
      );
    } catch (err) {
      this.logger.error(
        `Failed to schedule #${task.id} ${task.name}: ${(err as Error).message}`,
        { context: 'SchedulerService' },
      );
    }
  }

  private async respawn(task: SchedulerTask): Promise<void> {
    this.kill(task.id);
    if (task.enabled) await this.spawn(task);
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

  private async fire(task: SchedulerTask, operator: string, _source: string): Promise<void> {
    let status: 'success' | 'failure' = 'success';
    let message = '';
    try {
      const exec = await this.engine.execute(task.sceneCode, operator, {
        triggerType: 'schedule',
        triggerSource: operator,
      });
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
    // 更新 lastRunAt + nextRunAt
    const nextRunAt = this.calcNextRun(task.cron);
    try {
      await this.repo.update(task.id, {
        lastRunAt: new Date(),
        lastRunStatus: status,
        lastRunMessage: message,
        nextRunAt,
      });
    } catch (err) {
      this.logger.error(`Failed to update task ${task.id}: ${(err as Error).message}`, {
        context: 'SchedulerService',
      });
    }
    await this.logService.record({
      operator,
      action: 'scheduler.fire',
      targetType: 'scheduler',
      targetId: String(task.id),
      result: status,
      message,
    });
  }
}
