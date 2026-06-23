import { BadRequestException, Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { PlaybackService } from './playback.service';

/**
 * 鉴权策略 (Sprint-A 修正):
 *   推送 / 停止媒体属于"日常操作", 跟切灯切场景一个级别, 操作员在平板上随时
 *   要做. 不卡 admin token (admin token 是给"改系统配置"那种用的, 比如改 logo /
 *   改密码 / 改用户). 现场进入展厅 = 物理接触, 已经过了安全边界.
 */
@Controller('playback')
export class PlaybackController {
  constructor(private readonly service: PlaybackService) {}

  /** 拿所有通道状态. PlayerPage 起来时第一次拉 + 后台监控也读 */
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
   * 把媒体推到 slot. MediaPage / LedPage 用. 调用后 service 写库 + WS 广播,
   * PlayerPage 收到事件就切 video / image.
   */
  @Post('channels/:slot/publish')
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

  /** 清掉当前播, 回待机 */
  @Post('channels/:slot/stop')
  async stop(@Param('slot', ParseIntPipe) slot: number) {
    const view = await this.service.stop(slot);
    return { message: '已停止, 切回待机', data: view };
  }

  /** 暂停 slot3 BGM (bgm-player.ps1 下次轮询到后执行 MCI pause) */
  @Post('channels/:slot/pause')
  async pause(@Param('slot', ParseIntPipe) slot: number) {
    const view = await this.service.pause(slot);
    return { message: '已暂停', data: view };
  }

  /** 恢复 slot3 BGM (bgm-player.ps1 下次轮询到后执行 MCI resume) */
  @Post('channels/:slot/resume')
  async resume(@Param('slot', ParseIntPipe) slot: number) {
    const view = await this.service.resume(slot);
    return { message: '已恢复', data: view };
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
