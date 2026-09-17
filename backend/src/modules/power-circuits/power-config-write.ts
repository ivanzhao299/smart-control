import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { Repository } from 'typeorm';
import type { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { AuditLog } from '../../entities/audit-log.entity';
import { PowerCircuit } from '../../entities/power-circuit.entity';
import { User } from '../../entities/user.entity';
import { CreatePowerConfigDto, LegacyUpdatePowerConfigDto } from './power-config.dto';

const invalid = (message: string) =>
  new BadRequestException({ code: 'POWER_CONFIG_INVALID', message });
const conflict = () =>
  new ConflictException({
    code: 'POWER_CONFIG_REVISION_CONFLICT',
    message: '电源配置已变化，请保留草稿并重新读取',
  });

/** Pure relational configuration boundary: no adapter, live reading or second config store. */
export async function writePowerConfig(
  repository: Repository<PowerCircuit>,
  id: number | null,
  input: CreatePowerConfigDto | LegacyUpdatePowerConfigDto,
  actor?: Actor,
  remove = false,
): Promise<PowerCircuit> {
  const metatype: new () => LegacyUpdatePowerConfigDto =
    id === null ? CreatePowerConfigDto : LegacyUpdatePowerConfigDto;
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalid('配置必须是对象');
  const dto = plainToInstance(metatype, input) as LegacyUpdatePowerConfigDto;
  if (validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length)
    throw invalid('配置字段或修订号无效');
  const { expectedRevision, ...fields } = dto;
  // Keep an explicit allowlist through DTO validation; do not copy entity or read-only view fields.
  const patch = Object.fromEntries(
    Object.entries(fields)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]),
  );
  for (const field of ['gatewayCode', 'icon', 'description']) {
    if (patch[field] === '') patch[field] = null;
  }
  try {
    return await serializedTransaction(repository.manager.connection, async (manager) => {
      if (actor) {
        if (actor.role !== 'admin' || actor.kind === 'legacy')
          throw new ForbiddenException('仅管理员可修改电源配置');
        if (
          actor.kind === 'user' &&
          !(await manager.findOneBy(User, { id: actor.userId!, role: 'admin', enabled: true }))
        ) {
          throw new ForbiddenException('管理员权限已失效');
        }
      }
      const repo = manager.getRepository(PowerCircuit);
      const before = id === null ? null : await repo.findOneBy({ id });
      if (id !== null && !before)
        throw new NotFoundException({
          code: 'POWER_CONFIG_NOT_FOUND',
          message: '电源配置不存在或已删除',
        });
      if (before && expectedRevision !== undefined && before.configRevision !== expectedRevision)
        throw conflict();
      let saved: PowerCircuit;
      if (before && remove) {
        const result = await repo.delete({ id: before.id, configRevision: before.configRevision });
        if (result.affected !== 1) throw conflict();
        saved = before;
      } else if (!before) {
        saved = await repo.save(
          repo.create({
            category: 'misc',
            gatewayCode: null,
            relayChannel: null,
            meterAddress: null,
            ratedVoltage: 220,
            ratedCurrent: 16,
            ratedPower: 0,
            sortOrder: 100,
            icon: 'Zap',
            description: null,
            enabled: true,
            ...patch,
            configRevision: 1,
          }),
        );
      } else {
        const changes = Object.fromEntries(
          Object.entries(patch).filter(
            ([key, value]) =>
              JSON.stringify(before[key as keyof PowerCircuit]) !== JSON.stringify(value),
          ),
        );
        if (!Object.keys(changes).length) return before;
        if (
          !Number.isSafeInteger(before.configRevision) ||
          before.configRevision < 1 ||
          before.configRevision >= Number.MAX_SAFE_INTEGER
        ) {
          throw invalid('配置修订号超出安全范围');
        }
        const result = await repo.update(
          { id: before.id, configRevision: before.configRevision },
          { ...changes, configRevision: before.configRevision + 1 },
        );
        if (result.affected !== 1) throw conflict();
        saved = await repo.findOneByOrFail({ id: before.id });
      }
      await manager.insert(AuditLog, {
        entityType: 'power_circuit',
        entityId: String(saved.id),
        action: remove ? 'delete' : before ? 'update' : 'create',
        operator: actor?.username || 'system',
        snapshotBefore: before ? JSON.stringify(before) : null,
        snapshotAfter: remove ? null : JSON.stringify(saved),
        remark: `power-config:${remove ? 'delete' : 'write'}`,
      });
      return saved;
    });
  } catch (error) {
    if (/UNIQUE constraint failed: power_circuit\.code/.test((error as Error).message)) {
      throw new ConflictException({
        code: 'POWER_CONFIG_KEY_CONFLICT',
        message: '电源回路编号已被使用',
      });
    }
    throw error;
  }
}
