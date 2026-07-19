import { BadRequestException, Body, Controller, Get, HttpCode, Post, Put, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ClientAuthService } from './client-auth.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';

/**
 * /api/client-auth
 *
 * - GET /ping — 公开, 让登录页"测试连接"能验证 backend 在线
 * - POST /login — 公开, 业主输入密码 → 拿 token
 * - PUT /password — 需 admin token, 在后台改/重置客户端密码 (不要求旧密码)
 */
@Controller('client-auth')
export class ClientAuthController {
  constructor(private readonly service: ClientAuthService) {}

  @Get('ping')
  ping() {
    // 故意返回简单结构, 业主登录页只需要看 200 + ok:true 就知道 backend 通了.
    return { message: '在线', data: this.service.ping() };
  }

  @Post('login')
  @HttpCode(200)
  // 防爆破 (2026-07-19 加固): 按 IP 限流 10 次/分。正常业主输错几次不受影响, 但挡住
  // 公网对 4 位口令的秒级枚举 (枚举需要每秒多次)。RateLimitGuard 按 IP×路由 分桶。
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 60_000 })
  async login(@Body() body: { password?: string }) {
    if (!body?.password) {
      throw new BadRequestException('请输入密码');
    }
    try {
      const result = await this.service.login(body.password);
      return { message: '登录成功', data: result };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }

  @Put('password')
  @UseGuards(AdminGuard)
  async changePassword(@Body() body: { newPassword?: string }) {
    if (!body?.newPassword) {
      throw new BadRequestException('请输入新密码');
    }
    try {
      await this.service.resetPassword(body.newPassword);
      return { message: '密码已更新, 所有客户端需要重新登录', data: null };
    } catch (e) {
      if (e instanceof UnauthorizedException) throw e;
      throw new BadRequestException((e as Error).message);
    }
  }
}
