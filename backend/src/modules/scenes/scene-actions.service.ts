import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { Scene } from '../../entities/scene.entity';
import { SceneAction } from '../../entities/scene-action.entity';
import { OperationLogService } from '../logs/operation-log.service';
import {
  CreateSingleActionDto,
  UpdateSingleActionDto,
} from './dto/single-action.dto';
import { CommandDispatcherService } from '../../services/command-dispatcher.service';
import { AdapterResult } from '../../adapters/adapter.types';

@Injectable()
export class SceneActionsService {
  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneAction) private readonly actionRepo: Repository<SceneAction>,
    private readonly logService: OperationLogService,
    private readonly dispatcher: CommandDispatcherService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /**
   * 单动作"试触发" — 调试用. 不进 SceneEngine 队列, 不写 SceneExecution.
   * 直接走 CommandDispatcher 派发到对应 adapter, 等结果返给前端.
   * 让业主在编辑器里能立刻验"这条动作真能跑出灯亮 / 屏切吗".
   */
  async testOne(actionId: number, operator = 'admin'): Promise<AdapterResult> {
    const action = await this.actionRepo.findOne({ where: { id: actionId } });
    if (!action) throw new NotFoundException(`动作 ${actionId} 不存在`);
    let params: Record<string, unknown> = {};
    try {
      params = action.params ? JSON.parse(action.params) : {};
    } catch (e) {
      throw new BadRequestException(`动作 ${actionId} 的 params 不是合法 JSON: ${(e as Error).message}`);
    }
    const result = await this.dispatcher.dispatch({
      deviceType: action.deviceType,
      deviceId: action.deviceId,
      command: action.command,
      params,
    });
    await this.logService.record({
      operator,
      action: 'scene-action.test',
      targetType: 'scene_action',
      targetId: String(actionId),
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ deviceType: action.deviceType, deviceId: action.deviceId, command: action.command, params, ok: result.ok, error: (result as { error?: string }).error }),
    });
    return result;
  }

  async listForScene(sceneId: number): Promise<SceneAction[]> {
    await this.assertSceneExists(sceneId);
    return this.actionRepo.find({
      where: { sceneId },
      order: { sortOrder: 'ASC', id: 'ASC' },
    });
  }

  async create(sceneId: number, dto: CreateSingleActionDto): Promise<SceneAction> {
    await this.assertSceneExists(sceneId);
    const entity = this.actionRepo.create({
      sceneId,
      deviceType: dto.deviceType,
      deviceId: dto.deviceId,
      command: dto.command,
      params: JSON.stringify(dto.params ?? {}),
      delayMs: dto.delayMs ?? 0,
      sortOrder: dto.sortOrder ?? 0,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.actionRepo.save(entity);
    await this.logService.record({
      operator: 'admin',
      action: 'scene-action.create',
      targetType: 'scene-action',
      targetId: String(saved.id),
      message: `scene=${sceneId} ${saved.deviceType}.${saved.command}`,
    });
    return saved;
  }

  async update(actionId: number, dto: UpdateSingleActionDto): Promise<SceneAction> {
    const action = await this.actionRepo.findOne({ where: { id: actionId } });
    if (!action) throw new NotFoundException(`场景动作不存在: id=${actionId}`);

    if (dto.deviceType !== undefined) action.deviceType = dto.deviceType;
    if (dto.deviceId !== undefined) action.deviceId = dto.deviceId;
    if (dto.command !== undefined) action.command = dto.command;
    if (dto.params !== undefined) action.params = JSON.stringify(dto.params);
    if (dto.delayMs !== undefined) action.delayMs = dto.delayMs;
    if (dto.sortOrder !== undefined) action.sortOrder = dto.sortOrder;
    if (dto.enabled !== undefined) action.enabled = dto.enabled;

    const saved = await this.actionRepo.save(action);
    await this.logService.record({
      operator: 'admin',
      action: 'scene-action.update',
      targetType: 'scene-action',
      targetId: String(actionId),
      message: `scene=${action.sceneId} ${action.deviceType}.${action.command}`,
    });
    return saved;
  }

  async remove(actionId: number): Promise<void> {
    const action = await this.actionRepo.findOne({ where: { id: actionId } });
    if (!action) throw new NotFoundException(`场景动作不存在: id=${actionId}`);
    await this.actionRepo.remove(action);
    await this.logService.record({
      operator: 'admin',
      action: 'scene-action.delete',
      targetType: 'scene-action',
      targetId: String(actionId),
      message: `scene=${action.sceneId} ${action.deviceType}.${action.command}`,
    });
  }

  private async assertSceneExists(sceneId: number): Promise<void> {
    const exists = await this.sceneRepo.count({ where: { id: sceneId } });
    if (exists === 0) throw new NotFoundException(`场景不存在: id=${sceneId}`);
  }
}
