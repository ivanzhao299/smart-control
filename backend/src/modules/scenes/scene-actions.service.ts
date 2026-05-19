import { Inject, Injectable, NotFoundException } from '@nestjs/common';
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

@Injectable()
export class SceneActionsService {
  constructor(
    @InjectRepository(Scene) private readonly sceneRepo: Repository<Scene>,
    @InjectRepository(SceneAction) private readonly actionRepo: Repository<SceneAction>,
    private readonly logService: OperationLogService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

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
