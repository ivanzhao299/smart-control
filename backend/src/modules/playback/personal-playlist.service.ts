import { Injectable, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, In } from 'typeorm';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { User } from '../../entities/user.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { Actor } from '../../common/auth/actor';
import { visiblePlaylistWhere } from '../../common/auth/playlist-scope';
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
  private withCurrentActor<T>(actor: Actor, write: boolean, work: (current: Actor, repo: Repository<PlaylistItem>) => Promise<T>): Promise<T> {
    if (write) assertCanUpload(actor);
    return serializedTransaction(this.repo.manager.connection, async manager => {
      let current = actor;
      if (actor.userId !== null) {
        const user = await manager.findOneBy(User, { id: actor.userId, enabled: true });
        if (!user) throw new ForbiddenException('账户已停用');
        current = { ...actor, role: user.role };
      }
      if (write) assertCanUpload(current);
      return work(current, manager.getRepository(PlaylistItem));
    });
  }
  async list(actor: Actor, slot: number, scope: 'mine' | 'shared' | 'all' | 'visible' = 'mine') {
    this.slot(slot);
    if (!['mine', 'shared', 'all', 'visible'].includes(scope)) throw new BadRequestException('无效列表范围');
    return this.withCurrentActor(actor, false, async (current, repo) => {
      if (scope === 'all' && current.role !== 'admin') throw new ForbiddenException('仅管理员可查看全部列表');
      const owner = this.owner(current);
      const where = scope === 'visible' ? visiblePlaylistWhere(current, slot) : scope === 'all' ? { slot } : { slot, ownerUserId: scope === 'shared' || owner === null ? IsNull() : owner };
      const rows = await repo.find({ where, order: { sortOrder: 'ASC', id: 'ASC' } });
      const result = [];
      for (const row of rows) {
        const media = await repo.manager.findOneBy(MediaAsset, { id: row.mediaId });
        if (media) {
          try { assertReadResource(current, media); } catch { continue; }
        }
        result.push({ id: row.id, ownerUserId: row.ownerUserId, mediaId: row.mediaId, title: row.title ?? media?.originalName ?? '资料已删除', sortOrder: row.sortOrder, kind: media?.kind ?? null, durationSec: media?.durationSec ?? null, missing: !media });
      }
      return result;
    });
  }
  async add(actor: Actor, slot: number, mediaId: number, title?: string) {
    this.slot(slot); assertCanUpload(actor);
    if (!Number.isInteger(mediaId) || mediaId < 1) throw new BadRequestException('无效资料');
    if (title !== undefined && (typeof title !== 'string' || title.length > 120)) throw new BadRequestException('名称过长');
    const release = this.media.acquireOperation(mediaId);
    try { return await this.addLocked(actor, slot, mediaId, title); }
    finally { release(); }
  }
  private async addLocked(actor: Actor, slot: number, mediaId: number, title?: string) {
    return this.withCurrentActor(actor, true, async (current, repo) => {
      const media = await repo.manager.findOneBy(MediaAsset, { id: mediaId });
      if (!media) throw new NotFoundException('资料不存在');
      assertReadResource(current, media);
      const ownerUserId = this.owner(current);
      const where = { slot, ownerUserId: ownerUserId ?? IsNull() };
      const existing = await repo.findOne({ where: { ...where, mediaId } });
      if (existing) return { id: existing.id };
      const last = await repo.find({ where, order: { sortOrder: 'DESC' }, take: 1 });
      const saved = await repo.save(repo.create({ ownerUserId, slot, mediaId, title: title?.trim() || null, sortOrder: (last[0]?.sortOrder ?? 0) + 10 }));
      return { id: saved.id };
    });
  }
  async rename(actor: Actor, id: number, title: string) {
    if (typeof title !== 'string' || title.length > 120) throw new BadRequestException('名称过长');
    return this.withCurrentActor(actor, true, async (current, repo) => {
      const row = await repo.findOneBy({ id });
      if (!row) throw new NotFoundException('播放列表项不存在');
      this.writable(current, row);
      row.title = title.trim() || null;
      const updated = await repo.update(id, { title: row.title });
      if (!updated.affected) throw new NotFoundException('播放列表项已删除');
      return { id, title: row.title ?? '' };
    });
  }
  async remove(actor: Actor, id: number) {
    return this.withCurrentActor(actor, true, async (current, repo) => {
      const row = await repo.findOneBy({ id });
      if (!row) throw new NotFoundException('播放列表项不存在');
      this.writable(current, row);
      const deleted = await repo.delete(id);
      if (!deleted.affected) throw new NotFoundException('播放列表项已删除');
      return { id };
    });
  }
  async reorder(actor: Actor, slot: number, ids: number[]) {
    this.slot(slot); assertCanUpload(actor);
    if (!Array.isArray(ids) || ids.length > 500 || ids.some(id => !Number.isInteger(id) || id < 1) || new Set(ids).size !== ids.length) throw new BadRequestException('列表项无效');
    return this.withCurrentActor(actor, true, async (current, repo) => {
      if (!ids.length) return { count: 0 };
      const rows = await repo.findBy({ id: In(ids), slot });
      if (rows.length !== ids.length) throw new NotFoundException('播放列表项不存在');
      for (const row of rows) this.writable(current, row);
      if (new Set(rows.map(row => row.ownerUserId)).size !== 1) throw new BadRequestException('不能混排不同用户的列表');
      for (const row of rows) row.sortOrder = (ids.indexOf(row.id) + 1) * 10;
      for (const row of rows) {
        const updated = await repo.update(row.id, { sortOrder: row.sortOrder });
        if (!updated.affected) throw new NotFoundException('播放列表项已删除');
      }
      return { count: rows.length };
    });
  }
}
