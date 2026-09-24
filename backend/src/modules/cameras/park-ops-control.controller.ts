import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { GotoParkOpsPageDto, ToggleParkOpsAutoDto } from './dto/park-ops-control.dto';
import { ParkOpsControlService } from './park-ops-control.service';

/** PWA 播放控制卡片与无人值守运营大屏之间的短轮询控制通道。 */
@Controller('park-ops-control')
export class ParkOpsControlController {
  constructor(private readonly control: ParkOpsControlService) {}

  @Public()
  @Get('state')
  getState(@Query('consumeRefresh') consumeRefresh?: string) {
    return { success: true, data: this.control.getState(consumeRefresh === 'true') };
  }

  @Post('next')
  nextPage() {
    return { success: true, message: '下一页', data: this.control.nextPage() };
  }

  @Post('prev')
  prevPage() {
    return { success: true, message: '上一页', data: this.control.prevPage() };
  }

  @Post('goto')
  gotoPage(@Body() body: GotoParkOpsPageDto) {
    return {
      success: true,
      message: `跳转到第${body.page + 1}页`,
      data: this.control.gotoPage(body.page),
    };
  }

  @Post('auto')
  toggleAuto(@Body() body: ToggleParkOpsAutoDto) {
    const state = this.control.toggleAuto(body.enabled);
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
