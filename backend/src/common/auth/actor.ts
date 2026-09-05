import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import type { UserRole } from '../../entities/user.entity';

/** Only server-verified identities may populate this field. */
export interface Actor {
  kind: 'user' | 'legacy' | 'admin';
  userId: number | null;
  username: string;
  role: UserRole;
}

export type AuthenticatedRequest = Request & { actor?: Actor };

export function requireActor(req: AuthenticatedRequest): Actor {
  if (!req.actor) throw new UnauthorizedException('请使用个人账户登录');
  return req.actor;
}

export function requireAdmin(req: AuthenticatedRequest): Actor {
  const actor = requireActor(req);
  if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可操作');
  return actor;
}
