import { Body, Controller, Get, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import type { AuthenticatedRequest } from '../../common/auth/actor';
import { TestFlightService } from './testflight.service';
import { InviteTesterDto } from './dto/invite-tester.dto';

/**
 * TestFlight 内部测试员管理 (后台「iOS 测试」页)。
 * 全部路由仅管理员可用 —— 服务端持苹果密钥直接完成邀请, 不经 iOS App / CI。
 */
@Controller('testflight')
@UseGuards(AdminGuard)
export class TestFlightController {
  constructor(private readonly service: TestFlightService) {}

  /** 配置/密钥状态 + App、内部组、最新构建 + 计数 */
  @Get('overview')
  async overview() {
    return { message: '查询成功', data: await this.service.overview() };
  }

  /** 邀请记录列表 (默认用苹果侧实时状态校准) */
  @Get('testers')
  async testers() {
    return { message: '查询成功', data: await this.service.list(true) };
  }

  /** 邀请一名内部测试员 (幂等: 已邀请/已接受会直接回到对应状态) */
  @Post('testers')
  async invite(@Body() dto: InviteTesterDto, @Req() req: AuthenticatedRequest) {
    const operator = req.actor?.username ?? 'admin';
    const result = await this.service.invite(dto, operator);
    const message =
      result.state === 'invited'
        ? `已向 ${dto.email} 发送 TestFlight 内部测试邀请`
        : result.state === 'accepted'
          ? `${dto.email} 已是团队成员，可直接参与内部测试`
          : `${dto.email} 的邀请已存在，当前为待接受状态`;
    return { message, data: result };
  }

  /** 重发邀请 */
  @Post('testers/:id/resend')
  async resend(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    const operator = req.actor?.username ?? 'admin';
    const result = await this.service.resend(id, operator);
    return { message: `已重新向 ${result.tester.email} 发送邀请`, data: result };
  }
}
