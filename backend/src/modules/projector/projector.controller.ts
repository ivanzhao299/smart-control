import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { ProjectorService } from './projector.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';

/**
 * 投影视频融合器控制 API.
 *
 * 读 (status/windows/volume): 业主前台拉。写 (open/close/move/resize/volume): RateLimit 限速防抖。
 * 全局鉴权门已覆盖(需业主或后台 token)。
 */
@Controller('projector')
export class ProjectorController {
  constructor(private readonly service: ProjectorService) {}

  @Get('status')
  async status() {
    return { message: '查询成功', data: await this.service.status() };
  }

  @Get('windows')
  async windows() {
    return { message: '查询成功', data: await this.service.listWindows() };
  }

  @Post('windows/open')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 4, windowMs: 1000 })
  async open(@Body() b: { source: string; x?: number; y?: number; w?: number; h?: number }) {
    const data = await this.service.openWindow(b.source, b.x ?? 0, b.y ?? 0, b.w ?? 1, b.h ?? 1);
    return { message: '开窗成功', data };
  }

  @Post('windows/:id/close')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 4, windowMs: 1000 })
  async close(@Param('id', ParseIntPipe) id: number) {
    await this.service.closeWindow(id);
    return { message: '关窗成功', data: null };
  }

  @Post('windows/clean')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 2, windowMs: 1000 })
  async clean() {
    await this.service.cleanWindows();
    return { message: '已清空窗口', data: null };
  }

  @Post('windows/:id/move')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async move(@Param('id', ParseIntPipe) id: number, @Body() b: { x: number; y: number }) {
    await this.service.moveWindow(id, b.x, b.y);
    return { message: '移动成功', data: null };
  }

  @Post('windows/:id/resize')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async resize(@Param('id', ParseIntPipe) id: number, @Body() b: { w: number; h: number }) {
    await this.service.resizeWindow(id, b.w, b.h);
    return { message: '缩放成功', data: null };
  }

  @Get('windows/:id/volume')
  async getVolume(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.getVolume(id) };
  }

  @Post('windows/:id/volume')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async setVolume(@Param('id', ParseIntPipe) id: number, @Body() b: { volume: number }) {
    return { message: '调音量成功', data: await this.service.setVolume(id, b.volume) };
  }

  @Post('windows/:id/play')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async play(@Param('id', ParseIntPipe) id: number) {
    await this.service.play(id);
    return { message: '已播放', data: null };
  }

  @Post('windows/:id/pause')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async pause(@Param('id', ParseIntPipe) id: number) {
    await this.service.pause(id);
    return { message: '已暂停', data: null };
  }

  @Get('windows/:id/playlist')
  async getPlaylist(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.getPlaylist(id) };
  }

  @Post('windows/:id/playlist')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 8, windowMs: 1000 })
  async setPlaylist(@Param('id', ParseIntPipe) id: number, @Body() b: { index: number }) {
    const ok = await this.service.setPlaylistIndex(id, b.index);
    return { message: ok ? '已切换' : '切换失败(可能到头了)', data: { ok } };
  }
}
