import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import {
  ClaimParkOpsControlDto,
  GotoParkOpsPageDto,
  ParkOpsActionDto,
  ToggleParkOpsAutoDto,
} from './dto/park-ops-control.dto';
import { ParkOpsControlService } from './park-ops-control.service';

/** PWA 播放控制卡片与无人值守运营大屏之间的短轮询控制通道（默认现场主控，远程需接管）。 */
@Controller('park-ops-control')
export class ParkOpsControlController {
  constructor(private readonly control: ParkOpsControlService) {}

  @Public()
  @Get('state')
  getState(@Query('consumeRefresh') consumeRefresh?: string) {
    return { success: true, data: this.control.getState(consumeRefresh === 'true') };
  }

  @Post('claim')
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
}
