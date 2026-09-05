import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClientAuthService } from '../../modules/client-auth/client-auth.service';
import { AdminAuthService } from '../../modules/admin-auth/admin-auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import type { AuthenticatedRequest } from '../auth/actor';

/**
 * 全局鉴权门 (2026-07-21, 为封装 App 分发准备)。
 *
 * 之前: 后端无全局 guard, 业主侧所有控制/写 API 裸奔 —— 谁都能 curl 开关灯/推场景/
 * 甚至备份还原库。封装成 App 分发后暴露面更大, 必须先关这个口。
 *
 * 规则: 除 @Public 白名单外, 每个请求必须携带**有效的业主 token 或后台 token**。
 *   - 业主 (PWA/App): X-Client-Token header (http.ts 已自动带)。
 *   - 后台 (admin): Authorization: Bearer <token>。
 * 两者任一有效即放行 —— 这样后台用户只带 admin token 也能过全局门, 再由各写接口上的
 * AdminGuard 进一步限"仅后台"。避免"admin 路由要同时带两个 token"。
 *
 * kiosk 使用独立播放器凭据；其 Public 路由仍由设备 guard 或短时文件票据校验。
 * 本机请求和反向代理请求不豁免身份验证。
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clientAuth: ClientAuthService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    delete req.actor;

    const xClient = req.headers['x-client-token'];
    const clientTok = typeof xClient === 'string' ? xClient.trim() : '';
    const auth = req.headers['authorization'];
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (bearer && await this.adminAuth.verifyToken(bearer)) {
      req.actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
      return true;
    }
    for (const token of [clientTok, bearer]) {
      if (!token) continue;
      const actor = await this.clientAuth.resolveActor(token);
      if (actor) { req.actor = actor; return true; }
    }
    // Explicit invalid credentials must not gain privilege through a local proxy.
    if (clientTok || bearer) throw new UnauthorizedException('未登录或登录已过期, 请重新登录');
    throw new UnauthorizedException('未登录或登录已过期, 请重新登录');
  }
}
