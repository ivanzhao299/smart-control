import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseIntPipe, Post, Put } from '@nestjs/common';
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

  // ============ 播放列表 / 历史 / 上下曲 (2026-07-17) ============
  // 业主: "播放过的内容应该有播放历史, 平时经常播放的内容应该在播放列表里面, 随时可以
  //       切换播放列表内的内容, 在播放列表里面可以更改文件名字"
  //       "背景音乐及大屏播放都应该有播放控制功能, 不能一直无脑播放"
  //
  // ⚠️ 路由顺序: 这些两段/三段路径必须在 ':slot' 之类的单段参数路由**之前**声明,
  //    否则被 ParseIntPipe 吃掉 400 (light-zones 和 hvac 都踩过这个坑)。

  @Get('playlist/:slot')
  async playlist(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '查询成功', data: await this.service.listPlaylist(slot) };
  }

  /** 加进播放列表 —— 必须人工调用 (媒体库内容默认不进列表, 需管理员确认) */
  @Post('playlist/:slot')
  @HttpCode(200)
  async addPlaylist(
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { mediaId?: number; title?: string } = {},
  ) {
    if (typeof body?.mediaId !== 'number') throw new BadRequestException('mediaId 必填');
    return { message: '已加入播放列表', data: await this.service.addToPlaylist(slot, body.mediaId, body.title) };
  }

  /** 改别名 — 只改播放列表里的显示名, 不动媒体库原文件 */
  @Put('playlist/item/:id')
  async renamePlaylist(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { title?: string } = {},
  ) {
    if (typeof body?.title !== 'string') throw new BadRequestException('title 必填');
    return { message: '已改名', data: await this.service.renamePlaylistItem(id, body.title) };
  }

  @Delete('playlist/item/:id')
  @HttpCode(200)
  async removePlaylist(@Param('id', ParseIntPipe) id: number) {
    return { message: '已移出播放列表', data: await this.service.removeFromPlaylist(id) };
  }

  @Put('playlist/:slot/reorder')
  async reorderPlaylist(@Param('slot', ParseIntPipe) _slot: number, @Body() body: { ids?: number[] } = {}) {
    if (!Array.isArray(body?.ids)) throw new BadRequestException('ids 必填');
    return { message: '顺序已保存', data: await this.service.reorderPlaylist(body.ids) };
  }

  @Get('history/:slot')
  async history(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '查询成功', data: await this.service.listHistory(slot) };
  }

  /** 上一个 / 下一个 — 在播放列表里环形切换 */
  @Post('channels/:slot/next')
  @HttpCode(200)
  async next(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '已切到下一个', data: await this.service.step(slot, 1) };
  }

  @Post('channels/:slot/prev')
  @HttpCode(200)
  async prev(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '已切到上一个', data: await this.service.step(slot, -1) };
  }

  /**
   * 一首播完自动推进 —— bgm-player.ps1 播完当前曲就调这个, 后端按 playMode 决定
   * 下一首。这是"背景音乐不靠任何人开网页也能一直放"的核心 (见 service.advance)。
   */
  @Post('channels/:slot/advance')
  @HttpCode(200)
  async advance(@Param('slot', ParseIntPipe) slot: number) {
    return { message: '已推进', data: await this.service.advance(slot) };
  }

  /** 设背景音乐播放模式 (顺序/单曲/列表/随机). 前端点模式按钮时调, 存后端. */
  @Post('channels/:slot/play-mode')
  @HttpCode(200)
  async playMode(
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { mode?: string } = {},
  ) {
    const valid = ['seq', 'loop1', 'loopAll', 'shuffle'];
    if (!body?.mode || !valid.includes(body.mode)) {
      throw new BadRequestException(`mode 必须是 ${valid.join('/')}`);
    }
    return { message: '播放模式已保存', data: await this.service.setPlayMode(slot, body.mode as 'seq' | 'loop1' | 'loopAll' | 'shuffle') };
  }

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
