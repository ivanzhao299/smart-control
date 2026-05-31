import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ClientAuthService } from './client-auth.service';

/**
 * 客户端 token guard. 检查 Authorization: Bearer X-Client-Token <token>
 * 或自定义 header X-Client-Token.
 *
 * 暂时**不在**任何 controller 上挂 — 业主明确说"为 APP 准备", 先让 PWA 能登,
 * 但不强制所有 API 都要 token (现状很多 GET 公开). 等业主明确想加强再挂.
 */
@Injectable()
export class ClientAuthGuard implements CanActivate {
  constructor(private readonly service: ClientAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const auth = req.headers['authorization'] ?? '';
    const headerToken = req.headers['x-client-token'];
    let token = '';
    if (typeof headerToken === 'string') token = headerToken;
    else if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
      token = auth.slice(7);
    }
    if (!token) throw new UnauthorizedException('未携带客户端 token');
    const ok = await this.service.verifyToken(token);
    if (!ok) throw new UnauthorizedException('客户端 token 无效或已过期');
    return true;
  }
}
