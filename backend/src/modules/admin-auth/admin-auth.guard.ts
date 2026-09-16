import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthenticatedRequest, requireAdmin } from '../../common/auth/actor';
import { AdminAuthService } from './admin-auth.service';

/**
 * AdminGuard — 优先使用全局门禁解析出的个人管理员身份，并在过渡期兼容旧后台令牌。
 *
 * 用法 (在 controller / 方法上加):
 *   @UseGuards(AdminGuard)
 *   @Put('something')
 *   async sensitiveWrite() { ... }
 *
 * 保护范围 (本期):
 *   - PUT /api/system-branding (改 logo / 名称)
 *   - 管理配置与用户管理写接口
 *   - 后续逐步加到 用户管理 / 设备管理 / 场景管理 / 系统设置 等写接口
 *
 * 不加给:
 *   - GET 类查询 (前台所有页面需要读)
 *   - POST /api/admin/login (鉴权入口本身)
 *   - 物联网设备控制接口 (内部 loopback / 现场 LAN, 跟后台鉴权解耦)
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly authService: AdminAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // GlobalAuthGuard already resolved the current DB role for named accounts.
    // Never require a second, shared admin password from a verified administrator.
    if (req.actor) {
      requireAdmin(req);
      return true;
    }
    const auth = req.headers['authorization'];
    if (!auth || typeof auth !== 'string' || !auth.startsWith('Bearer ')) {
      throw new UnauthorizedException('缺少 admin 登录 token, 请先登录后台');
    }
    const token = auth.slice('Bearer '.length).trim();
    const ok = await this.authService.verifyToken(token);
    if (!ok) {
      throw new UnauthorizedException('登录已过期或被注销, 请重新登录');
    }
    return true;
  }
}
