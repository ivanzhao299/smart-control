import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

/**
 * Only server-verified identities may populate this field.
 * role 为动态角色 code（RBAC 后不再锁死枚举，可为管理员新建的自定义角色 code）。
 */
export interface Actor {
  kind: 'user' | 'legacy' | 'admin';
  userId: number | null;
  username: string;
  role: string;
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
