import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Actor } from './actor';

export interface OwnedResource {
  ownerUserId: number | null;
  visibility: 'private' | 'shared';
}

export function canReadResource(actor: Actor, resource: OwnedResource): boolean {
  return actor.role === 'admin' || resource.visibility === 'shared'
    || (actor.kind === 'user' && actor.userId !== null && actor.userId === resource.ownerUserId);
}

export function assertReadResource(actor: Actor, resource: OwnedResource): void {
  // Same response as an unknown ID: do not disclose existence of another user's content.
  if (!canReadResource(actor, resource)) throw new NotFoundException('资料不存在');
}

export function assertWriteResource(actor: Actor, resource: OwnedResource): void {
  assertReadResource(actor, resource);
  if (actor.role === 'admin') return;
  if (actor.kind !== 'user' || actor.role !== 'operator' || actor.userId === null
    || actor.userId !== resource.ownerUserId || resource.visibility === 'shared') {
    throw new ForbiddenException('仅可管理自己的私人资料');
  }
}

export function assertCanUpload(actor: Actor): void {
  if (actor.role === 'admin') return;
  if (actor.kind !== 'user' || actor.userId === null || actor.role !== 'operator') {
    throw new ForbiddenException('请使用有上传权限的个人账户');
  }
}

export function assertCanPublish(actor: Actor, resource: OwnedResource): void {
  assertCanUpload(actor);
  assertReadResource(actor, resource);
}
