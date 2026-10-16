import { Controller, Post, Get, Param, ParseIntPipe, UseGuards, HttpCode, Headers, Query, Res, Header, Body, Req, ForbiddenException } from '@nestjs/common';
import { Response, Request } from 'express';
import { PlayerDeviceAccessService } from './player-device-access.service';
import { Public } from '../../common/decorators/public.decorator';
import { PlayerDeviceGuard } from './player-device.guard';
import { PlaybackService } from './playback.service';
import { sendMediaFile } from '../../common/utils/send-media-file';

/** Public skips user auth; state/heartbeat require device auth, stream validates its bound grant. */
@Public()
@Controller('player-device/:slot')
export class PlayerDeviceController {
  constructor(private readonly playback: PlaybackService, private readonly access: PlayerDeviceAccessService) {}

  private requireLocal(req: Request): void {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) throw new ForbiddenException('文档守护只允许本机设备调用');
  }

  @Get('doc-info')
  @UseGuards(PlayerDeviceGuard)
  @Header('Cache-Control', 'private, no-store')
  async docInfo(@Req() req: Request, @Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string, @Query('session') session: string) {
    this.requireLocal(req);
    return { message: 'ok', data: await this.access.docInfo(slot, token, session) };
  }

  @Post('doc-meta')
  @UseGuards(PlayerDeviceGuard)
  async docMeta(@Req() req: Request, @Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string, @Body() body: { playbackSession?: string; pageCount?: number; pdfReady?: boolean; reservationId?: string }) {
    this.requireLocal(req);
    return { message: 'ok', data: await this.access.docMeta(slot, token, body?.playbackSession ?? '', body?.pageCount, body?.pdfReady, body?.reservationId) };
  }

  @Post('doc-prepare')
  @UseGuards(PlayerDeviceGuard)
  @Header('Cache-Control', 'private, no-store')
  async prepareDocument(@Req() req: Request, @Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string, @Body() body: { playbackSession?: string }) {
    this.requireLocal(req);
    return { message: 'ok', data: await this.access.prepareDocument(slot, token, body?.playbackSession ?? '') };
  }

  @Get('state')
  @UseGuards(PlayerDeviceGuard)
  @Header('Cache-Control', 'private, no-store')
  async state(@Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string) {
    return { message: 'ok', data: await this.access.state(slot, token) };
  }

  @Get('stream')
  async stream(@Param('slot', ParseIntPipe) slot: number, @Query('ticket') ticket: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    const file = await this.access.stream(slot, ticket, range);
    sendMediaFile(res, file);
  }

  @Post('heartbeat')
  @UseGuards(PlayerDeviceGuard)
  @HttpCode(200)
  async heartbeat(
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { fps?: number; stalls?: number; healthy?: boolean },
  ) {
    await this.playback.heartbeat(slot, body ?? undefined);
    return { message: 'ok', data: null };
  }

  @Post('advance')
  @UseGuards(PlayerDeviceGuard)
  @HttpCode(200)
  async advance(@Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string, @Body() body: { playbackSession?: string }) {
    return { message: 'ok', data: await this.access.advance(slot, token, body?.playbackSession ?? '') };
  }

  /** 大屏视频播放进度上报 (2026-10, 约 1s 一次): 仅内存态, 控制端进度条据此移动 */
  @Post('progress')
  @UseGuards(PlayerDeviceGuard)
  @HttpCode(200)
  async progress(
    @Param('slot', ParseIntPipe) slot: number,
    @Body() body: { currentTime?: number; duration?: number; paused?: boolean; ended?: boolean; mediaId?: number | null },
  ) {
    this.playback.reportProgress(slot, body ?? {});
    return { message: 'ok', data: null };
  }
}
