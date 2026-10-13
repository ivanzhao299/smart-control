import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ModuleRef, Reflector } from '@nestjs/core';
import { AdminModule, canReadModule, canWriteModule, isReadMethod } from '../auth/rbac';
import { MODULE_ACCESS_KEY } from '../decorators/module-access.decorator';
import type { AuthenticatedRequest } from '../auth/actor';
import { ClientAuthService } from '../../modules/client-auth/client-auth.service';
import { AdminAuthService } from '../../modules/admin-auth/admin-auth.service';

/**
 * ModuleAccessGuard — 后台分域 RBAC 守卫。
 *
 * GlobalAuthGuard 已为非 @Public 路由解析出 req.actor（含真实 role）；本守卫按
 * @ModuleAccess('xxx') 声明的模块矩阵做读写判定：
 *   - GET/HEAD/OPTIONS：canReadModule（前台共用读放行登录用户，后台专属读按角色）。
 *   - POST/PUT/PATCH/DELETE：canWriteModule（admin 全通，其余需是该模块负责角色）。
 * 若用在类级 @Public 控制器上（全局守卫不预解析身份），经全局容器懒解析
 * X-Client-Token / Bearer，兼容旧版共享后台令牌（视为 admin）。
 */
@Injectable()
export class ModuleAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const module = this.reflector.getAllAndOverride<AdminModule>(MODULE_ACCESS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!module) return true;

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

    if (isReadMethod(req.method)) {
      if (!canReadModule(actor.role, module)) {
        throw new ForbiddenException('当前角色无权查看该模块');
      }
    } else if (!canWriteModule(actor.role, module)) {
      throw new ForbiddenException('当前角色无权修改该模块');
    }
    return true;
  }
}
