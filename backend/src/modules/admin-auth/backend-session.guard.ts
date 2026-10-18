import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { AdminAuthService } from './admin-auth.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { PermissionService } from '../rbac/permission.service';

/**
 * BackendSessionGuard — 后台「登录态」门禁。
 *
 * 只判断当前持令牌者是否属于可进入后台的角色(admin / hardware / config),
 * 用于后台会话校验类接口(如 GET /admin/auth/me)。它不做任何分域写权限判断。
 *
 * 与 AdminGuard 的区别:
 *   - AdminGuard          = 系统类/敏感操作, 仅 admin(保持不变)。
 *   - BackendSessionGuard = 三个后台角色任一即可, 用于"我是否已登录后台"。
 *
 * 兼容旧版共享后台令牌(verifyToken 通过即视为后台会话)。
 */
@Injectable()
export class BackendSessionGuard implements CanActivate {
  constructor(
    private readonly authService: AdminAuthService,
    private readonly moduleRef: ModuleRef,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // 全局门禁已解析命名账户的情况。
    if (req.actor) {
      const actor = requireActor(req);
      const perm = this.moduleRef.get(PermissionService, { strict: false });
      if (!perm?.canLoginBack(actor.role)) {
        throw new UnauthorizedException('该账号无权进入后台');
      }
      return true;
    }

    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少后台登录 token, 请先登录后台');
    }
    const token = auth.slice('Bearer '.length).trim();

    // 类级 @Public 的控制器上全局守卫不预解析 actor, 这里经全局容器懒解析命名账户。
    const clientAuth = this.moduleRef.get(ClientAuthService, { strict: false });
    const actor = clientAuth ? await clientAuth.resolveActor(token) : null;
    if (actor) {
      const perm = this.moduleRef.get(PermissionService, { strict: false });
      if (!perm?.canLoginBack(actor.role)) {
        throw new UnauthorizedException('该账号无权进入后台');
      }
      req.actor = actor;
      return true;
    }

    // 兼容旧版共享后台令牌。
    const ok = await this.authService.verifyToken(token);
    if (!ok) {
      throw new UnauthorizedException('登录已过期或被注销, 请重新登录');
    }
    return true;
  }
}
