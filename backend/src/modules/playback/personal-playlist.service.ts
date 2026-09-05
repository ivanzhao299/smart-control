import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload, assertReadResource } from '../../common/auth/resource-policy';
import { MediaService } from '../media/media.service';

@Injectable()
export class PersonalPlaylistService {
  constructor(@InjectRepository(PlaylistItem) private readonly repo: Repository<PlaylistItem>, private readonly media: MediaService) {}

  private slot(slot: number): void {
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new BadRequestException('无效播放通道');
  }
  private owner(actor: Actor) { return actor.kind === 'user' ? actor.userId : null; }
  private writable(actor: Actor, row: PlaylistItem): void {
    assertCanUpload(actor);
    if (actor.role !== 'admin' && (actor.userId === null || actor.userId !== row.ownerUserId)) throw new NotFoundException('播放列表项不存在');
  }
  async list(actor: Actor, slot: number, scope: 'mine' | 'shared' | 'all' = 'mine') {
    this.slot(slot);
    if (!['mine', 'shared', 'all'].includes(scope)) throw new BadRequestException('无效列表范围');
    if (scope === 'all' && actor.role !== 'admin') throw new ForbiddenException('仅管理员可查看全部列表');
    const owner = this.owner(actor);
    const where = scope === 'all' ? { slot } : { slot, ownerUserId: scope === 'shared' || owner === null ? IsNull() : owner };
    const rows = await this.repo.find({ where, order: { sortOrder: 'ASC', id: 'ASC' } });
    const result = [];
    for (const row of rows) {
      const media = await this.media.get(row.mediaId).catch(() => null);
      if (media) {
        try { assertReadResource(actor, media); } catch { continue; }
      }
      result.push({ id: row.id, ownerUserId: row.ownerUserId, mediaId: row.mediaId, title: row.title ?? media?.originalName ?? '资料已删除', sortOrder: row.sortOrder, kind: media?.kind ?? null, durationSec: media?.durationSec ?? null, missing: !media });
    }
    return result;
  }
  async add(actor: Actor, slot: number, mediaId: number, title?: string) {
    this.slot(slot); assertCanUpload(actor);
    if (!Number.isInteger(mediaId) || mediaId < 1) throw new BadRequestException('无效资料');
    if (title !== undefined && (typeof title !== 'string' || title.length > 120)) throw new BadRequestException('名称过长');
    await this.media.authorized(mediaId, actor);
    const ownerUserId = this.owner(actor);
    const where = { slot, ownerUserId: ownerUserId ?? IsNull() };
    const existing = await this.repo.findOne({ where: { ...where, mediaId } });
    if (existing) return { id: existing.id };
    const last = await this.repo.find({ where, order: { sortOrder: 'DESC' }, take: 1 });
    const saved = await this.repo.save(this.repo.create({ ownerUserId, slot, mediaId, title: title?.trim() || null, sortOrder: (last[0]?.sortOrder ?? 0) + 10 }));
    return { id: saved.id };
  }
  async rename(actor: Actor, id: number, title: string) {
    if (typeof title !== 'string' || title.length > 120) throw new BadRequestException('名称过长');
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('播放列表项不存在');
    this.writable(actor, row);
    row.title = title.trim() || null;
    await this.repo.save(row);
    return { id, title: row.title ?? '' };
  }
  async remove(actor: Actor, id: number) {
    const row = await this.repo.findOneBy({ id });
    if (!row) throw new NotFoundException('播放列表项不存在');
    this.writable(actor, row);
    await this.repo.remove(row);
    return { id };
  }
  async reorder(actor: Actor, slot: number, ids: number[]) {
    this.slot(slot); assertCanUpload(actor);
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new BadRequestException('列表项无效');
    if (!ids.length) return { count: 0 };
    const rows = await this.repo.findBy({ id: In(ids), slot });
    if (rows.length !== ids.length) throw new NotFoundException('播放列表项不存在');
    for (const row of rows) this.writable(actor, row);
    if (new Set(rows.map(row => row.ownerUserId)).size !== 1) throw new BadRequestException('不能混排不同用户的列表');
    for (const row of rows) row.sortOrder = (ids.indexOf(row.id) + 1) * 10;
    await this.repo.save(rows);
    return { count: rows.length };
  }
}
