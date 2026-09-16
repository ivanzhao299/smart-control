import { BadRequestException, Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { AdminGuard } from './admin-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(
    private readonly legacyAuth: AdminAuthService,
    private readonly identityAuth: ClientAuthService,
  ) {}

  /**
   * POST /api/admin/auth/login — 公开. 管理员个人账号登录.
   * 前端进 /admin 路由前 / 进入后没 token 时调.
   */
  @Public()
  @Post('login')
  @HttpCode(200)
  // 防爆破 (2026-07-19 加固): 按 IP 限流 10 次/分, 挡住对后台口令的枚举。
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 60_000 })
  async login(@Body() body: { username?: string; password?: string } = {}) {
    const username = body?.username?.trim();
    if (!username || !body?.password || typeof body.password !== 'string') {
      throw new BadRequestException('username + password 都必填');
    }
    const { token, expiresAt } = await this.identityAuth.loginAdministrator(username, body.password);
    return { message: '登录成功', data: { token, expiresAt } };
  }

  /**
   * GET /api/admin/auth/me — 验证当前 token 还有效.
   * 前端启动时 / 路由切换时调, 知道要不要弹登录框.
   */
  @Get('me')
  @UseGuards(AdminGuard)
  async me() {
    return { message: 'ok', data: { authenticated: true } };
  }

  /**
   * POST /api/admin/auth/logout — 销毁当前 token.
   * 不严格要求 guard, 因为反正要把 token 扔了.
   */
  @Public()
  @Post('logout')
  async logout(@Headers('authorization') auth?: string) {
    if (auth && auth.startsWith('Bearer ')) {
      const token = auth.slice('Bearer '.length).trim();
      this.legacyAuth.logout(token);
      this.identityAuth.logout(token);
    }
    return { message: '已注销', data: null };
  }
}
