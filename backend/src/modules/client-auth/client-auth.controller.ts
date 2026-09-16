import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ClientAuthService } from './client-auth.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { Req } from '@nestjs/common';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';

/**
 * /api/client-auth
 *
 * - GET /ping — 公开, 让登录页"测试连接"能验证 backend 在线
 * - POST /login — 公开, 个人用户名密码 → 拿 token
 */
@Controller('client-auth')
export class ClientAuthController {
  constructor(private readonly service: ClientAuthService) {}

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
  // 防爆破 (2026-07-19 加固): 按 IP 限流 10 次/分。正常业主输错几次不受影响, 但挡住
  // 公网对 4 位口令的秒级枚举 (枚举需要每秒多次)。RateLimitGuard 按 IP×路由 分桶。
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 60_000 })
  async login(@Body() body: { username?: string; password?: string }) {
    const username = body?.username?.trim();
    if (!username || !body?.password) {
      throw new BadRequestException('请输入用户名和密码');
    }
    const result = await this.service.login(username, body.password);
    return { message: '登录成功', data: result };
  }

}
