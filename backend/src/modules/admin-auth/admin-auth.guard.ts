import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Request } from 'express';
import { AdminAuthService } from './admin-auth.service';

/**
 * AdminGuard — 检查 Authorization: Bearer <token> 是否在 service 内存 session 表里.
 *
 * 用法 (在 controller / 方法上加):
 *   @UseGuards(AdminGuard)
 *   @Put('something')
 *   async sensitiveWrite() { ... }
 *
 * 保护范围 (本期):
 *   - PUT /api/system-branding (改 logo / 名称)
 *   - POST /api/admin/change-password
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
    const req = context.switchToHttp().getRequest<Request>();
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
