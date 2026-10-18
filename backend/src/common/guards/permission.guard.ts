import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { REQUIRE_PERMISSION_KEY } from '../decorators/require-permission.decorator';
import type { AuthenticatedRequest } from '../auth/actor';
import { ClientAuthService } from '../../modules/client-auth/client-auth.service';
import { AdminAuthService } from '../../modules/admin-auth/admin-auth.service';
import { PermissionService } from '../../modules/rbac/permission.service';

/**
 * PermissionGuard — 基于 @RequirePermission('资源:动作') 原子权限点的守卫（动态 RBAC）。
 *
 * 判定：admin 恒全；其余角色查 PermissionService 内存权限集（来源 rbac_role_permission）。
 * 多个权限点为 OR（任一满足放行）。
 *
 * GlobalAuthGuard 已为非 @Public 路由解析出 req.actor；本守卫只比对权限点。若用在类级
 * @Public 控制器上（全局守卫不预解析身份），则经全局容器懒解析 X-Client-Token / Bearer，
 * 兼容旧版共享后台令牌（视为 admin）。
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(REQUIRE_PERMISSION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    let actor = req.actor;

    if (!actor) {
      const xClient = req.headers['x-client-token'];
      const clientTok = typeof xClient === 'string' ? xClient.trim() : '';
      const auth = req.headers['authorization'];
      const bearer =
        typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

      const clientAuth = this.moduleRef.get(ClientAuthService, { strict: false });
      for (const token of [clientTok, bearer]) {
        if (!token || !clientAuth) continue;
        const resolved = await clientAuth.resolveActor(token);
        if (resolved) {
          actor = resolved;
          req.actor = resolved;
          break;
        }
      }
      if (!actor && bearer) {
        const adminAuth = this.moduleRef.get(AdminAuthService, { strict: false });
        if (adminAuth && (await adminAuth.verifyToken(bearer))) {
          actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
          req.actor = actor;
        }
      }
    }

    if (!actor) throw new UnauthorizedException('未登录或登录已过期，请重新登录');

    const permService = this.moduleRef.get(PermissionService, { strict: false });
    const allowed = permService && required.some((code) => permService.hasPermission(actor!.role, code));
    if (!allowed) {
      throw new ForbiddenException('当前角色无权执行该操作（缺少权限点）');
    }
    return true;
  }
}
