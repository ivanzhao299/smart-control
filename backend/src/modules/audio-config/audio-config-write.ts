import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FindOptionsWhere, Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { AuditLog } from '../../entities/audit-log.entity';
import { User } from '../../entities/user.entity';
import type { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';

type VersionedRow = { id: number; configRevision: number };
const conflict = () =>
  new ConflictException({
    code: 'AUDIO_CONFIG_REVISION_CONFLICT',
    message: '音响配置已被其他管理员修改，请保留草稿并重新载入最新配置',
  });
export const invalidAudioConfig = (message: string) =>
  new BadRequestException({ code: 'AUDIO_CONFIG_INVALID', message });

/** Shared transaction boundary for all three relational audio catalogs. No second config store. */
export async function mutateAudioConfig<T extends VersionedRow, R>(
  repository: Repository<T>,
  id: number | null,
  expectedRevision: number | undefined,
  actor: Actor | undefined,
  work: (manager: EntityManager, repo: Repository<T>, row: T | null) => Promise<R>,
): Promise<R> {
  if (
    expectedRevision !== undefined &&
    (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1)
  )
    throw invalidAudioConfig('无效配置修订号');
  if (id === null && expectedRevision !== undefined)
    throw invalidAudioConfig('新建配置不能携带已有修订号');
  try {
    return await serializedTransaction(repository.manager.connection, async (manager) => {
      if (actor) {
        if (actor.role !== 'admin' || actor.kind === 'legacy')
          throw new ForbiddenException('仅管理员可修改音响配置');
        if (
          actor.kind === 'user' &&
          !(await manager.findOneBy(User, { id: actor.userId!, enabled: true, role: 'admin' }))
        )
          throw new ForbiddenException('管理员权限已失效');
      }
      const repo = manager.getRepository(repository.target);
      const row = id === null ? null : await repo.findOneBy({ id } as FindOptionsWhere<T>);
      if (id !== null && !row)
        throw new NotFoundException({
          code: 'AUDIO_CONFIG_NOT_FOUND',
          message: '音响配置不存在或已删除',
        });
      if (row && expectedRevision !== undefined && row.configRevision !== expectedRevision)
        throw conflict();
      return work(manager, repo, row);
    });
  } catch (error) {
    if (
      /UNIQUE constraint failed: audio_(output_zone\.channel|input_source\.channel|scene\.preset_num)/.test(
        (error as Error).message,
      )
    ) {
      throw new ConflictException({
        code: 'AUDIO_CONFIG_KEY_CONFLICT',
        message: '通道号或预设号已被使用',
      });
    }
    throw error;
  }
}

/** Store only changed fields, so catalog edits never write stale live gain/mute intent. */
export async function saveAudioConfigRow<T extends VersionedRow>(
  manager: EntityManager,
  repo: Repository<T>,
  before: T | null,
  row: T,
  actor?: Actor,
): Promise<T> {
  let saved: T;
  if (!before) {
    row.configRevision = 1;
    saved = await repo.save(row);
  } else {
    const changes: Record<string, unknown> = {};
    for (const key of Object.keys(row) as Array<keyof T>) {
      if (
        key !== 'id' &&
        key !== 'configRevision' &&
        JSON.stringify(row[key]) !== JSON.stringify(before[key])
      )
        changes[String(key)] = row[key];
    }
    if (!Object.keys(changes).length) return row;
    if (
      !Number.isSafeInteger(before.configRevision) ||
      before.configRevision < 1 ||
      before.configRevision >= Number.MAX_SAFE_INTEGER
    )
      throw invalidAudioConfig('配置修订号超出安全范围');
    changes.configRevision = before.configRevision + 1;
    const result = await repo
      .createQueryBuilder()
      .update()
      .set(changes as QueryDeepPartialEntity<T>)
      .where('id = :id AND config_revision = :revision', {
        id: before.id,
        revision: before.configRevision,
      })
      .execute();
    if (result.affected !== 1) throw conflict();
    saved = await repo.findOneByOrFail({ id: before.id } as FindOptionsWhere<T>);
  }
  await manager.insert(AuditLog, {
    entityType: repo.metadata.tableName,
    entityId: String(saved.id),
    action: before ? 'update' : 'create',
    operator: actor?.username || 'system',
    snapshotBefore: before ? JSON.stringify(before) : null,
    snapshotAfter: JSON.stringify(saved),
    remark: 'audio-config:catalog-write',
  });
  return saved;
}

export async function deleteAudioConfigRow<T extends VersionedRow>(
  manager: EntityManager,
  repo: Repository<T>,
  row: T,
  actor?: Actor,
): Promise<{ removedId: number }> {
  await manager.insert(AuditLog, {
    entityType: repo.metadata.tableName,
    entityId: String(row.id),
    action: 'delete',
    operator: actor?.username || 'system',
    snapshotBefore: JSON.stringify(row),
    snapshotAfter: null,
    remark: 'audio-config:catalog-delete',
  });
  const result = await repo
    .createQueryBuilder()
    .delete()
    .where('id = :id AND config_revision = :revision', { id: row.id, revision: row.configRevision })
    .execute();
  if (result.affected !== 1) throw conflict();
  return { removedId: row.id };
}
