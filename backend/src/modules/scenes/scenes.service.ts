import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { DataSource, FindOptionsWhere, Like, Repository } from 'typeorm';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { Logger } from 'winston';
import { Scene } from '../../entities/scene.entity';
import { SceneAction } from '../../entities/scene-action.entity';
import { AuditLog } from '../../entities/audit-log.entity';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';
import { SceneActionDto } from './dto/scene-action.dto';
import { OperationLogService } from '../logs/operation-log.service';
import { PagedResult } from '../devices/devices.service';

@Injectable()
export class ScenesService {
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

      await mgr.insert(AuditLog, { entityType: 'scene', entityId: String(saved.id), action: 'create', operator,
        snapshotBefore: null, snapshotAfter: JSON.stringify(saved), remark: 'scene configuration' });

      this.logger.info(`Scene created: #${saved.id} ${saved.code}`, { context: 'ScenesService' });
      await this.logService.record({
        operator,
        action: 'scene.create',
        targetType: 'scene',
        targetId: String(saved.id),
        message: saved.code,
      }, mgr);

      const reload = await mgr.findOne(Scene, { where: { id: saved.id } });
      if (!reload) throw new NotFoundException(`场景创建后未找到: id=${saved.id}`);
      return reload;
    });
  }

  async update(id: number, dto: UpdateSceneDto, operator = 'system'): Promise<Scene> {
    if (!Number.isInteger(dto.expectedRevision) || dto.expectedRevision < 1) {
      throw new BadRequestException('expectedRevision must be a positive integer');
    }
    return serializedTransaction(this.dataSource, async (mgr) => {
      const scene = await mgr.findOne(Scene, { where: { id } });
      if (!scene) throw new NotFoundException(`场景不存在: id=${id}`);
      if (scene.configRevision !== dto.expectedRevision) {
        throw new ConflictException({ code: 'SCENE_REVISION_CONFLICT', expectedRevision: dto.expectedRevision, currentRevision: scene.configRevision });
      }
      const before = { ...scene, actions: scene.actions };

      if (dto.code && dto.code !== scene.code) {
        const dup = await mgr.findOne(Scene, { where: { code: dto.code } });
        if (dup && dup.id !== id) throw new ConflictException(`场景编码已存在: ${dto.code}`);
        scene.code = dto.code;
      }
      if (dto.name !== undefined) scene.name = dto.name;
      if (dto.description !== undefined) scene.description = dto.description;
      if (dto.enabled !== undefined) scene.enabled = dto.enabled;
      const changed = dto.code !== undefined || dto.name !== undefined || dto.description !== undefined || dto.enabled !== undefined || dto.actions !== undefined;
      if (!changed) return scene;
      scene.configRevision += 1;
      await mgr.save(scene);

      if (dto.actions) {
        await mgr.delete(SceneAction, { sceneId: id });
        if (dto.actions.length > 0) {
          const actions = dto.actions.map((a) => this.buildAction(id, a));
          await mgr.save(SceneAction, actions);
        }
      }

      const after = await mgr.findOne(Scene, { where: { id } });
      await mgr.insert(AuditLog, { entityType: 'scene', entityId: String(id), action: 'update', operator,
        snapshotBefore: JSON.stringify(before), snapshotAfter: JSON.stringify(after), remark: 'scene configuration' });

      this.logger.info(`Scene updated: #${id}`, { context: 'ScenesService' });
      await this.logService.record({
        operator,
        action: 'scene.update',
        targetType: 'scene',
        targetId: String(id),
        message: scene.code,
      }, mgr);

      const reload = after;
      if (!reload) throw new NotFoundException(`场景更新后未找到: id=${id}`);
      return reload;
    });
  }

  async remove(id: number, expectedRevision: number, operator = 'system'): Promise<void> {
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) throw new BadRequestException('expectedRevision must be a positive integer');
    await serializedTransaction(this.dataSource, async (mgr) => {
      const scene = await mgr.findOne(Scene, { where: { id } });
      if (!scene) throw new NotFoundException(`场景不存在: id=${id}`);
      if (scene.configRevision !== expectedRevision) throw new ConflictException({ code: 'SCENE_REVISION_CONFLICT', expectedRevision, currentRevision: scene.configRevision });
      await mgr.remove(scene);
      await mgr.insert(AuditLog, { entityType: 'scene', entityId: String(id), action: 'delete', operator,
        snapshotBefore: JSON.stringify(scene), snapshotAfter: null, remark: 'scene configuration' });
      await this.logService.record({ operator, action: 'scene.delete', targetType: 'scene', targetId: String(id), message: scene.code }, mgr);
      this.logger.info(`Scene removed: #${id}`, { context: 'ScenesService' });
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
