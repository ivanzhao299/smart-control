import { Body, Controller, Get, HttpCode, Param, ParseIntPipe, Post, Req, UseGuards } from '@nestjs/common';
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

  /** 邀请记录列表 (进页面自动与 App Store Connect 对账一次, 60s 节流) */
  @Get('testers')
  async testers() {
    return { message: '查询成功', data: await this.service.list(true) };
  }

  /** 手动强制与 App Store Connect 同步 (绕过节流), 把 ASC 现有内部测试员/待接受邀请对账进本地台账 */
  @Post('sync')
  @HttpCode(200)
  async sync() {
    return { message: '已与 App Store Connect 同步', data: await this.service.syncFromApple(true) };
  }

  /** 当前一键续期任务状态 (前端在触发后轮询) */
  @Get('renewal')
  async renewal() {
    return { message: '查询成功', data: this.service.getRenewalState() };
  }

  /**
   * 一键续期: 触发 GitHub Actions 在 macOS 重新归档/云签名/上传新 TestFlight build。
   * 仅触发, 进度通过 GET /renewal 轮询。
   */
  @Post('renew')
  @HttpCode(200)
  async renew(@Req() req: AuthenticatedRequest) {
    const operator = req.actor?.username ?? 'admin';
    return { message: '已触发 TestFlight 续期构建', data: await this.service.renewBuild(operator) };
  }

  /** 邀请一名内部测试员 (幂等: 已邀请/已接受会直接回到对应状态) */
  @Post('testers')
  async invite(@Body() dto: InviteTesterDto, @Req() req: AuthenticatedRequest) {
    const operator = req.actor?.username ?? 'admin';
    const result = await this.service.invite(dto, operator);
    const message =
      result.state === 'invited'
        ? `已向 ${dto.email} 发送 App Store Connect 团队邀请`
        : result.state === 'accepted'
          ? `${dto.email} 已是团队成员，可在内部测试组中重发 TestFlight 安装邀请`
          : `${dto.email} 的邀请已存在，当前为待接受状态`;
    return { message, data: result };
  }

  /**
   * 重发邀请。旧邀请已失效（被撤销/过期）时重新发起；仍待接受且 App Manager 密钥无权撤销时，
   * 返回 state=pending + notice 引导人工处理（不报错、不把记录标记为失败）。
   */
  @Post('testers/:id/resend')
  async resend(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    const operator = req.actor?.username ?? 'admin';
    const result = await this.service.resend(id, operator);
    const message =
      result.state === 'testflight-invited'
        ? `已重新向 ${result.tester.email} 发送 TestFlight 安装邀请`
        : result.state === 'team-invited'
          ? `已重新向 ${result.tester.email} 发送 App Store Connect 团队邀请`
        : result.state === 'accepted'
          ? (result.notice ?? `${result.tester.email} 已是团队成员`)
          : (result.notice ?? `${result.tester.email} 的邀请仍处于待接受状态`);
    return { message, data: result };
  }
}
