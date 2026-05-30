import { BadRequestException, Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AdminAuthService } from './admin-auth.service';
import { AdminGuard } from './admin-auth.guard';

@Controller('admin/auth')
export class AdminAuthController {
  constructor(private readonly service: AdminAuthService) {}

  /**
   * POST /api/admin/auth/login — 公开. 输 password → 拿 token.
   * 前端进 /admin 路由前 / 进入后没 token 时调.
   */
  @Post('login')
  async login(@Body() body: { password?: string } = {}) {
    if (!body?.password || typeof body.password !== 'string') {
      throw new BadRequestException('password 必填');
    }
    const { token, expiresAt } = await this.service.login(body.password);
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
  @Post('logout')
  async logout(@Headers('authorization') auth?: string) {
    if (auth && auth.startsWith('Bearer ')) {
      this.service.logout(auth.slice('Bearer '.length).trim());
    }
    return { message: '已注销', data: null };
  }

  /**
   * POST /api/admin/auth/change-password — 改密码. 要登录态 + 旧密码.
   * 改完后 service 清掉所有 session, 包括当前这个, 前端会被踢到登录页.
   */
  @Post('change-password')
  @UseGuards(AdminGuard)
  async changePassword(@Body() body: { oldPassword?: string; newPassword?: string } = {}) {
    if (!body?.oldPassword || !body?.newPassword) {
      throw new BadRequestException('oldPassword + newPassword 都必填');
    }
    await this.service.changePassword(body.oldPassword, body.newPassword);
    return { message: '密码已修改, 所有登录 session 已失效', data: null };
  }
}
