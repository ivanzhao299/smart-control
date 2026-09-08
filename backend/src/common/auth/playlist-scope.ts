import { IsNull, type FindOptionsWhere } from 'typeorm';
import type { Actor } from './actor';
import type { PlaylistItem } from '../../entities/playlist-item.entity';

/** Controls include the historical shared list without exposing another user's list. */
export function visiblePlaylistWhere(actor: Actor, slot: number): FindOptionsWhere<PlaylistItem> | FindOptionsWhere<PlaylistItem>[] {
  if (actor.role === 'admin') return { slot };
  const shared = { slot, ownerUserId: IsNull() };
  return actor.kind === 'user' && actor.userId !== null
    ? [shared, { slot, ownerUserId: actor.userId }]
    : shared;
}
