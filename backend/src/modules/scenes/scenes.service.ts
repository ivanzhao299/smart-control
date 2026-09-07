import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { RECOMMENDED_SCENE_ACTIONS } from '../../seed/recommended-scene-actions';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DataSource, FindOptionsWhere, Like, Repository } from 'typeorm';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { Logger } from 'winston';
import { Scene } from '../../entities/scene.entity';
import { SceneAction } from '../../entities/scene-action.entity';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';
import { SceneActionDto } from './dto/scene-action.dto';
import { OperationLogService } from '../logs/operation-log.service';
import { PagedResult } from '../devices/devices.service';

@Injectable()
export class ScenesService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await this.healRecommendedActions();
  }

  /**
   * 一次性割接 (2026-07-26): 首页四个情景模式按现场接线现实重建推荐动作编排。
   *
   * 旧动作是 2026-05 规划期的数据: 灯光 deviceId '1'-'12' 不带 slaveId (两台
   * 网关组号重复, 必然打错灯)、audio_1f/audio_2f 设备已不存在、还引用已删除
   * 的会议/清洁场景 —— 点场景卡片等于放空枪。CI 不跑 seed、seed 又遇已有
   * 动作就跳过, 不 heal 新编排永远上不了生产 (老坑)。
   *
   * 做法: 对 opening/reception/roadshow/closing 四个场景, 清空旧动作、写入
   * RECOMMENDED_SCENE_ACTIONS (推荐起点, 业主在后台动作配置里随意微调)。
   * 一次性哨兵 = logs/scene-actions-v2.done 标记文件 —— 割接一次后永不再动,
   * 业主的后续调整不会被冲掉。
   */
  private async healRecommendedActions(): Promise<void> {
    try {
      const flag = resolve(process.cwd(), '..', 'logs', 'scene-actions-v2.done');
      if (await fs.access(flag).then(() => true).catch(() => false)) return;
      for (const [code, actions] of Object.entries(RECOMMENDED_SCENE_ACTIONS)) {
        const scene = await this.sceneRepo.findOne({ where: { code } });
        if (!scene) {
          this.logger.warn(`[Scenes] 推荐编排: 场景 ${code} 不存在, 跳过`, { context: 'ScenesService' });
          continue;
        }
        await this.actionRepo.delete({ sceneId: scene.id });
        for (let i = 0; i < actions.length; i += 1) {
          const a = actions[i];
          await this.actionRepo.save(this.actionRepo.create({
            sceneId: scene.id,
            deviceType: a.deviceType,
            deviceId: a.deviceId,
            command: a.command,
            params: JSON.stringify(a.params ?? {}),
            delayMs: a.delayMs ?? 0,
            sortOrder: (i + 1) * 10,
            enabled: true,
          }));
        }
        this.logger.warn(`[Scenes] 场景 ${code} 动作已重建为推荐编排 (${actions.length} 条)`, { context: 'ScenesService' });
      }
      await fs.mkdir(resolve(process.cwd(), '..', 'logs'), { recursive: true }).catch(() => {});
      await fs.writeFile(flag, new Date().toISOString()).catch(() => {});
    } catch (e) {
      this.logger.warn(`[Scenes] 推荐编排割接失败: ${(e as Error).message}`, { context: 'ScenesService' });
    }
  }

  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneAction) private readonly actionRepo: Repository<SceneAction>,
    private readonly logService: OperationLogService,
    private readonly dataSource: DataSource,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async findAll(query: QuerySceneDto): Promise<PagedResult<Scene>> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;

    const where: FindOptionsWhere<Scene> = {};
    if (query.enabled !== undefined) where.enabled = query.enabled;
    if (query.keyword) where.name = Like(`%${query.keyword}%`);

    const [list, total] = await this.sceneRepo.findAndCount({
      where,
      order: { id: 'ASC' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { list, total, page, pageSize };
  }

  async findOne(id: number): Promise<Scene> {
    const scene = await this.sceneRepo.findOne({ where: { id } });
    if (!scene) throw new NotFoundException(`场景不存在: id=${id}`);
    return scene;
  }

  async create(dto: CreateSceneDto, operator = 'system'): Promise<Scene> {
    const exists = await this.sceneRepo.findOne({ where: { code: dto.code } });
    if (exists) throw new ConflictException(`场景编码已存在: ${dto.code}`);

    return serializedTransaction(this.dataSource, async (mgr) => {
      const scene = mgr.create(Scene, {
        code: dto.code,
        name: dto.name,
        description: dto.description ?? null,
        enabled: dto.enabled ?? true,
      });
      const saved = await mgr.save(scene);

      if (dto.actions && dto.actions.length > 0) {
        const actions = dto.actions.map((a) => this.buildAction(saved.id, a));
        await mgr.save(SceneAction, actions);
      }

      this.logger.info(`Scene created: #${saved.id} ${saved.code}`, { context: 'ScenesService' });
      await this.logService.record({
        operator,
        action: 'scene.create',
        targetType: 'scene',
        targetId: String(saved.id),
        message: saved.code,
      });

      const reload = await mgr.findOne(Scene, { where: { id: saved.id } });
      if (!reload) throw new NotFoundException(`场景创建后未找到: id=${saved.id}`);
      return reload;
    });
  }

  async update(id: number, dto: UpdateSceneDto, operator = 'system'): Promise<Scene> {
    return serializedTransaction(this.dataSource, async (mgr) => {
      const scene = await mgr.findOne(Scene, { where: { id } });
      if (!scene) throw new NotFoundException(`场景不存在: id=${id}`);

      if (dto.code && dto.code !== scene.code) {
        const dup = await mgr.findOne(Scene, { where: { code: dto.code } });
        if (dup && dup.id !== id) throw new ConflictException(`场景编码已存在: ${dto.code}`);
        scene.code = dto.code;
      }
      if (dto.name !== undefined) scene.name = dto.name;
      if (dto.description !== undefined) scene.description = dto.description;
      if (dto.enabled !== undefined) scene.enabled = dto.enabled;
      await mgr.save(scene);

      if (dto.actions) {
        await mgr.delete(SceneAction, { sceneId: id });
        if (dto.actions.length > 0) {
          const actions = dto.actions.map((a) => this.buildAction(id, a));
          await mgr.save(SceneAction, actions);
        }
      }

      this.logger.info(`Scene updated: #${id}`, { context: 'ScenesService' });
      await this.logService.record({
        operator,
        action: 'scene.update',
        targetType: 'scene',
        targetId: String(id),
        message: scene.code,
      });

      const reload = await mgr.findOne(Scene, { where: { id } });
      if (!reload) throw new NotFoundException(`场景更新后未找到: id=${id}`);
      return reload;
    });
  }

  async remove(id: number, operator = 'system'): Promise<void> {
    const scene = await this.findOne(id);
    await this.sceneRepo.remove(scene);
    this.logger.info(`Scene removed: #${id}`, { context: 'ScenesService' });
    await this.logService.record({
      operator,
      action: 'scene.delete',
      targetType: 'scene',
      targetId: String(id),
      message: scene.code,
    });
  }

  private buildAction(sceneId: number, dto: SceneActionDto): SceneAction {
    return this.actionRepo.create({
      sceneId,
      deviceType: dto.deviceType,
      deviceId: dto.deviceId,
      command: dto.command,
      params: JSON.stringify(dto.params ?? {}),
      delayMs: dto.delayMs ?? 0,
      sortOrder: dto.sortOrder ?? 0,
      enabled: dto.enabled ?? true,
    });
  }
}
