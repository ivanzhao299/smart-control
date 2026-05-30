import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { PlaybackService } from './playback.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

@Controller('playback')
export class PlaybackController {
  constructor(private readonly service: PlaybackService) {}

  /** 拿所有通道状态. 公开 — PlayerPage 起来时第一次拉 + 后台监控也读 */
  @Get('channels')
  async list() {
    return { message: '查询成功', data: await this.service.list() };
  }

  /** 拿指定 slot 当前状态. PlayerPage 启动时按 ?slot=N 拉 */
  @Get('channels/:slot')
  async getOne(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '查询成功', data: await this.service.getBySlot(slot) };
  }

  /**
   * 把媒体推到 slot. 要 admin token (避免任意人推内容).
   *
   * MediaPage / LedPage 用. 调用后 service 写库 + WS 广播, PlayerPage 收到
   * 事件就切 video / image.
   */
  @Post('channels/:slot/publish')
  @UseGuards(AdminGuard)
  async publish(
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { mediaId?: number; loopMode?: 'once' | 'loop' } = {},
  ) {
    if (typeof body?.mediaId !== 'number') {
      throw new BadRequestException('mediaId 必填');
    }
    const view = await this.service.publishMedia(slot, body.mediaId, { loopMode: body.loopMode });
    return { message: '已推送', data: view };
  }

  /** 清掉当前播, 回待机. 要 admin token */
  @Post('channels/:slot/stop')
  @UseGuards(AdminGuard)
  async stop(@Param('slot', ParseIntPipe) slot: number) {
    const view = await this.service.stop(slot);
    return { message: '已停止, 切回待机', data: view };
  }

  /**
   * PlayerPage 心跳上报. 不要 guard — kiosk 浏览器不会有 admin token.
   * 频率: 每 30s 一次. 服务端只看时间戳, 不广播 WS.
   */
  @Post('channels/:slot/heartbeat')
  async heartbeat(@Param('slot', ParseIntPipe) slot: number) {
    await this.service.heartbeat(slot);
    return { message: 'ok', data: null };
  }
}
