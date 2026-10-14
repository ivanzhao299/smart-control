import { Body, Controller, ForbiddenException, Get, Post, Query, UseGuards } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { LprService } from '../lpr/lpr.service';
import {
  ClaimParkOpsControlDto,
  GateOpenParkOpsDto,
  GotoParkOpsPageDto,
  ParkOpsActionDto,
  ToggleParkOpsAutoDto,
} from './dto/park-ops-control.dto';
import { ParkOpsControlService } from './park-ops-control.service';
import { ParkOpsGuard } from './park-ops-guard.guard';

/** PWA 播放控制卡片与无人值守运营大屏之间的短轮询控制通道（默认现场主控，远程需接管）。 */
@Controller('park-ops-control')
export class ParkOpsControlController {
  constructor(
    private readonly control: ParkOpsControlService,
    private readonly lpr: LprService,
  ) {}

  @Public()
  @Get('state')
  getState(@Query('consumeRefresh') consumeRefresh?: string) {
    return { success: true, data: this.control.getState(consumeRefresh === 'true') };
  }

  // 现场大屏(park-ops-screen)匿名登记主控；远程接管者(其它 ownerId)必须登录，由 ParkOpsGuard 拦截
  @Public()
  @Post('claim')
  @UseGuards(ParkOpsGuard)
  @RateLimit({ max: 20, windowMs: 10_000 })
  claim(@Body() body: ClaimParkOpsControlDto) {
    return {
      success: true,
      message: '已接管大屏控制，90秒无操作将自动还权现场',
      data: this.control.claimControl(body.ownerId, body.ownerName),
    };
  }

  @Post('release')
  release(@Body() body: ParkOpsActionDto) {
    return {
      success: true,
      message: '已释放大屏控制，控制权回到现场',
      data: this.control.releaseControl(body?.ownerId),
    };
  }

  @Post('next')
  nextPage(@Body() body: ParkOpsActionDto) {
    return { success: true, message: '下一页', data: this.control.nextPage(body?.ownerId) };
  }

  @Post('prev')
  prevPage(@Body() body: ParkOpsActionDto) {
    return { success: true, message: '上一页', data: this.control.prevPage(body?.ownerId) };
  }

  @Post('goto')
  gotoPage(@Body() body: GotoParkOpsPageDto) {
    return {
      success: true,
      message: `跳转到第${body.page + 1}页`,
      data: this.control.gotoPage(body.page, body.ownerId),
    };
  }

  @Post('auto')
  toggleAuto(@Body() body: ToggleParkOpsAutoDto) {
    const state = this.control.toggleAuto(body.enabled, body.ownerId);
    return {
      success: true,
      message: state.autoPlay ? '自动轮播已开启' : '自动轮播已关闭',
      data: state,
    };
  }

  @Post('refresh')
  requestRefresh() {
    return {
      success: true,
      message: '已发送强制刷新指令，运营大屏将在1秒内刷新',
      data: this.control.requestRefresh(),
    };
  }

  /**
   * 人车管理页远程开闸：复用大屏接管锁（现场未被接管时仅现场大屏可触发，接管期仅
   * 接管者可触发），叠加限流；实际开闸与审计由 LprService.openGate 完成，写操作可追溯。
   */
  @Public()
  @Post('gate-open')
  @UseGuards(RateLimitGuard, ParkOpsGuard)
  @RateLimit({ max: 8, windowMs: 5000 })
  async gateOpen(@Body() body: GateOpenParkOpsDto) {
    const auth = this.control.gateAuthorization(body.ownerId);
    if (!auth.allowed) {
      throw new ForbiddenException(
        auth.claimed ? '大屏正被其他终端接管，暂无法开闸' : '仅现场运营大屏可执行开闸',
      );
    }
    const data = await this.lpr.openGate(
      { deviceId: body.deviceId, serialno: body.serialno, reason: body.reason },
      `park-ops:${auth.holderName}`,
    );
    return {
      success: true,
      message: data.delivered ? '开闸指令已下发' : '相机当前未连接，已排队，下次通讯时开闸',
      data,
    };
  }

  /**
   * 人车管理页远程关闸（落杆）：与 gate-open 同样复用接管锁与限流；实际关闸与审计由
   * LprService.closeGate 完成（走通用 IO 控制，对落杆继电器发先通后断脉冲）。
   * 未配置关闸 IO 的通道（靠地感自动落杆）由 LprService 返回 400。
   */
  @Public()
  @Post('gate-close')
  @UseGuards(RateLimitGuard, ParkOpsGuard)
  @RateLimit({ max: 8, windowMs: 5000 })
  async gateClose(@Body() body: GateOpenParkOpsDto) {
    const auth = this.control.gateAuthorization(body.ownerId);
    if (!auth.allowed) {
      throw new ForbiddenException(
        auth.claimed ? '大屏正被其他终端接管，暂无法关闸' : '仅现场运营大屏可执行关闸',
      );
    }
    const data = await this.lpr.closeGate(
      { deviceId: body.deviceId, serialno: body.serialno, reason: body.reason },
      `park-ops:${auth.holderName}`,
    );
    return {
      success: true,
      message: data.delivered ? '关闸指令已下发' : '相机当前未连接，已排队，下次通讯时关闸',
      data,
    };
  }
}
