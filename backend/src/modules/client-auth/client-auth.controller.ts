import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ClientAuthService } from './client-auth.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';

/**
 * /api/client-auth
 *
 * - GET /ping — 公开, 让登录页"测试连接"能验证 backend 在线
 * - POST /login — 公开, 个人用户名密码 → 拿 token
 */
@Controller('client-auth')
export class ClientAuthController {
  constructor(
    private readonly service: ClientAuthService,
    private readonly rateLimit: RateLimitGuard,
  ) {}

  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    return { message: 'ok', data: requireActor(req) };
  }

  @Public()
  @Get('ping')
  ping() {
    // 故意返回简单结构, 业主登录页只需要看 200 + ok:true 就知道 backend 通了.
    return { message: '在线', data: this.service.ping() };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  // 防爆破: 按 IP 限流 20 次/分，登录成功即清零（弱网重发/正常重试不累计）；
  // 超限返回 429 + Retry-After。nginx 层另有同口径第二层限流。
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 20, windowMs: 60_000 })
  async login(
    @Req() req: Request,
    @Body() body: { username?: string; password?: string },
  ) {
    const username = body?.username?.trim();
    if (!username || !body?.password) {
      throw new BadRequestException('请输入用户名和密码');
    }
    const result = await this.service.login(username, body.password);
    // 成功登录：清除该 IP 限流计数，避免弱网下一次正常登录被历史重试拖累。
    this.rateLimit.reset(req);
    return { message: '登录成功', data: result };
  }

}
