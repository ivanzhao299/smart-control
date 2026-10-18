import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { UserRole } from '../../entities/user.entity';
import { requireActor, type AuthenticatedRequest } from '../auth/actor';
import { WRITE_ROLES_KEY } from '../decorators/write-roles.decorator';

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

/**
 * WriteRoleGuard — 前台设备实体控制的「写角色」守卫。
 *
 * 2026-10-16 第二轮最小权限收敛新增：GlobalAuthGuard 只拦 viewer 的写操作，导致
 * operator/hardware/config 也能下发音响/灯光/电源/道闸等实体控制（曾误触「全场静音」）。
 * 本守卫按 @WriteRoles(...) 白名单只对**写方法**（POST/PUT/PATCH/DELETE）做角色校验；
 * 读方法（GET/HEAD/OPTIONS）一律放行，避免影响前台/大屏的状态读取。
 *
 * 身份（req.actor）已由 GlobalAuthGuard 解析；此处只比对角色。
 */
@Injectable()
export class WriteRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (READ_METHODS.includes((req.method ?? 'GET').toUpperCase())) return true;

    const roles = this.reflector.getAllAndOverride<UserRole[]>(WRITE_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) return true;

    const actor = requireActor(req);
    if (!(roles as readonly string[]).includes(actor.role)) {
      throw new ForbiddenException(`当前角色无权操作该设备（需：${roles.join('、')}）`);
    }
    return true;
  }
}
