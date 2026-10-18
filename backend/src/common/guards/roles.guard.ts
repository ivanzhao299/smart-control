import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import type { UserRole } from '../../entities/user.entity';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { AuthenticatedRequest } from '../auth/actor';
import { ClientAuthService } from '../../modules/client-auth/client-auth.service';
import { AdminAuthService } from '../../modules/admin-auth/admin-auth.service';

/**
 * RolesGuard — 基于 @Roles(...) 白名单的角色守卫。
 *
 * GlobalAuthGuard 已为非 @Public 路由解析出 req.actor（含真实 role）；本守卫只做
 * 角色比对。若用在类级 @Public 控制器上（全局守卫不预解析身份），则经全局容器懒解析
 * X-Client-Token / Bearer，兼容旧版共享后台令牌（视为 admin）。
 *
 *   @UseGuards(RolesGuard)
 *   @Roles('admin', 'operator')
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
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
    if (!(required as readonly string[]).includes(actor.role)) {
      throw new ForbiddenException(`该操作需要以下角色之一：${required.join('、')}`);
    }
    return true;
  }
}
