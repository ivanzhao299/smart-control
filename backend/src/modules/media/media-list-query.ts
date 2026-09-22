import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Repository } from 'typeorm';
import type { Actor } from '../../common/auth/actor';
import { MediaAsset, MediaKind } from '../../entities/media-asset.entity';
import { MediaListItem } from './dto/media.dto';

export interface MediaListOptions {
  kind?: MediaKind;
  limit?: number;
  offset?: number;
  actor?: Actor;
  scope?: 'visible' | 'mine' | 'shared';
  ownerUserId?: number;
  keyword?: string;
}

export interface MediaListResult {
  items: MediaListItem[];
  total: number;
}

export function toMediaListItem(media: MediaAsset): MediaListItem {
  return {
    ownerUserId: media.ownerUserId,
    visibility: media.visibility,
    source: media.source,
    id: media.id,
    originalName: media.originalName,
    kind: media.kind,
    mimeType: media.mimeType,
    sizeBytes: Number(media.sizeBytes),
    durationSec: media.durationSec,
    resolution: media.resolution,
    remark: media.remark,
    uploader: media.uploader,
    thumbUrl: media.thumbPath ? `/api/media/${media.id}/thumb` : null,
    fileUrl: media.kind === 'webpage' ? (media.sourceUrl ?? '') : `/api/media/${media.id}/file`,
    lastPlayedAt: media.lastPlayedAt ? media.lastPlayedAt.toISOString() : null,
    createdAt: media.createdAt.toISOString(),
    processingStatus: media.processingStatus ?? 'ready',
    processingError: media.processingError ?? null,
  };
}

export async function queryMediaList(
  repo: Repository<MediaAsset>,
  options: MediaListOptions,
): Promise<MediaListResult> {
  if (
    options.keyword !== undefined &&
    (typeof options.keyword !== 'string' || options.keyword.length > 200)
  ) {
    throw new BadRequestException('搜索文本过长');
  }
  if (options.scope && !['visible', 'mine', 'shared'].includes(options.scope)) {
    throw new BadRequestException('无效资料范围');
  }
  if (options.ownerUserId !== undefined) {
    if (options.actor?.role !== 'admin') {
      throw new ForbiddenException('仅管理员可按用户筛选');
    }
    if (!Number.isInteger(options.ownerUserId) || options.ownerUserId < 1) {
      throw new BadRequestException('无效用户');
    }
  }
  for (const [value, min] of [
    [options.limit, 1],
    [options.offset, 0],
  ] as const) {
    if (value !== undefined && (!Number.isSafeInteger(value) || value < min)) {
      throw new BadRequestException('无效分页参数');
    }
  }

  const query = repo
    .createQueryBuilder('m')
    .orderBy('m.createdAt', 'DESC')
    .addOrderBy('m.id', 'DESC');
  if (options.keyword?.trim()) {
    query.andWhere('instr(lower(m.originalName), lower(:keyword)) > 0', {
      keyword: options.keyword.trim(),
    });
  }
  if (options.actor && options.actor.role !== 'admin') {
    query.andWhere('(m.visibility = :shared OR m.ownerUserId = :owner)', {
      shared: 'shared',
      owner: options.actor.kind === 'user' ? options.actor.userId : null,
    });
  }
  if (options.kind) query.andWhere('m.kind = :k', { k: options.kind });
  if (options.scope === 'shared') {
    query.andWhere('m.visibility = :visibility', { visibility: 'shared' });
  }
  if (options.scope === 'mine') {
    if (!options.actor || options.actor.userId === null) query.andWhere('1 = 0');
    else query.andWhere('m.ownerUserId = :mine', { mine: options.actor.userId });
  }
  if (options.ownerUserId !== undefined) {
    query.andWhere('m.ownerUserId = :selectedOwner', {
      selectedOwner: options.ownerUserId,
    });
  }

  const total = await query.getCount();
  if (typeof options.limit === 'number') query.take(options.limit);
  if (typeof options.offset === 'number') query.skip(options.offset);
  const rows = await query.getMany();
  return { items: rows.map(toMediaListItem), total };
}
