import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ClientAuthService } from '../../modules/client-auth/client-auth.service';
import { AdminAuthService } from '../../modules/admin-auth/admin-auth.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

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
 * kiosk 大屏无人值守: 不给它发 token, 而是把它真正需要的那几个拉流/心跳/推进端点标 @Public
 * (见 playback / media controller), 所以大屏自愈不受影响。
 */
@Injectable()
export class GlobalAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly clientAuth: ClientAuthService,
    private readonly adminAuth: AdminAuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // 2026-07-24: 业主明确要求关闭"用户/业主鉴权"门 —— 现场频繁因 token 过期被踢出、
    // 报"没有权限操作", 严重影响使用。默认放行**所有**请求。后台写接口仍由各自的
    // @UseGuards(AdminGuard) 独立保护 (admin-auth / audio-config / power-circuits /
    // light-zones / system-branding / app-release / client-auth), 这部分不受影响。
    // ⚠️ 安全提示: 关闭后, 未单独挂 AdminGuard 的控制器 (devices / hardware / scenes /
    // scheduler / media / audio / playback / lighting / hvac 等) 在网络可达范围内无鉴权。
    // 要重新启用全局用户门: 设环境变量 CLIENT_AUTH_ENABLED=true。
    if (process.env.CLIENT_AUTH_ENABLED !== 'true') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const xClient = req.headers['x-client-token'];
    const clientTok = typeof xClient === 'string' ? xClient.trim() : '';
    const auth = req.headers['authorization'];
    const bearer = typeof auth === 'string' && auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';

    // 业主 token (X-Client-Token) 优先
    if (clientTok && (await this.clientAuth.verifyToken(clientTok))) return true;
    // Bearer: 先当后台 token 验, 再兜底当业主 token (兼容把 client token 放 Bearer 的老路径)
    if (bearer) {
      if (await this.adminAuth.verifyToken(bearer)) return true;
      if (await this.clientAuth.verifyToken(bearer)) return true;
    }
    throw new UnauthorizedException('未登录或登录已过期, 请重新登录');
  }
}
