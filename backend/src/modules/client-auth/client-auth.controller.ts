import { BadRequestException, Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ClientAuthService } from './client-auth.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { ReadOnlyRequest } from '../../common/decorators/read-only-request.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { PermissionService } from '../rbac/permission.service';

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
    private readonly permissions: PermissionService,
  ) {}

  /**
   * 当前登录身份：在 actor 之外下发动态 RBAC 的权限集与登录方向，
   * 供前端 store 做按钮/菜单/路由的原子权限判定（permissions / canFront / canBack）。
   */
  @Get('me')
  me(@Req() req: AuthenticatedRequest) {
    const actor = requireActor(req);
    return { message: 'ok', data: { ...actor, ...this.permissions.identityForUser(actor.userId, actor.role) } };
  }

  /**
   * POST /client-auth/change-password — 已登录用户改自己的密码(不区分后台/前台)。
   * 不挂任何模块权限: 任何个人账户都能改自己; @ReadOnlyRequest 让只读(viewer)
   * 账户也能执行 —— 该操作只改本人凭证, 不触及业务/系统/设备状态。
   * 必须验原密码; 成功后旧令牌因密码指纹变化立即失效, 前端清会话并重新登录。
   */
  @ReadOnlyRequest()
  @Post('change-password')
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 10, windowMs: 60_000 })
  async changePassword(
    @Req() req: AuthenticatedRequest,
    @Body() dto: ChangePasswordDto,
  ) {
    const actor = requireActor(req);
    if (actor.userId === null) {
      throw new BadRequestException('当前为共享登录会话，请使用个人账号登录后再修改密码');
    }
    await this.service.changePassword(actor.userId, dto.oldPassword, dto.newPassword);
    // 成功后清零限流计数，避免一次成功改密被历史输错拖累。
    this.rateLimit.reset(req);
    return { message: '密码已修改，请重新登录', data: null };
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
