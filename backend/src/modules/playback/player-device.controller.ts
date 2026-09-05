import { Controller, Post, Get, Param, ParseIntPipe, UseGuards, HttpCode, Headers, Query, Res, Header, Body } from '@nestjs/common';
import { Response } from 'express';
import { PlayerDeviceAccessService } from './player-device-access.service';
import { Public } from '../../common/decorators/public.decorator';
import { PlayerDeviceGuard } from './player-device.guard';
import { PlaybackService } from './playback.service';

/** Public skips user auth; state/heartbeat require device auth, stream validates its bound grant. */
@Public()
@Controller('player-device/:slot')
export class PlayerDeviceController {
  constructor(private readonly playback: PlaybackService, private readonly access: PlayerDeviceAccessService) {}

  @Get('state')
  @UseGuards(PlayerDeviceGuard)
  @Header('Cache-Control', 'private, no-store')
  async state(@Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string) {
    return { message: 'ok', data: await this.access.state(slot, token) };
  }

  @Get('stream')
  async stream(@Param('slot', ParseIntPipe) slot: number, @Query('ticket') ticket: string, @Headers('range') range: string | undefined, @Res() res: Response) {
    const file = await this.access.stream(slot, ticket, range);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Length', file.size);
    res.setHeader('Accept-Ranges', 'bytes');
    if (file.contentRange) res.setHeader('Content-Range', file.contentRange);
    res.status(file.status);
    if (!file.stream) { res.end(); return; }
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(file.filename)}"`);
    file.stream.on('error', () => res.destroy());
    res.on('close', () => file.stream?.destroy());
    file.stream.pipe(res);
  }

  @Post('heartbeat')
  @UseGuards(PlayerDeviceGuard)
  @HttpCode(200)
  async heartbeat(@Param('slot', ParseIntPipe) slot: number) {
    await this.playback.heartbeat(slot);
    return { message: 'ok', data: null };
  }

  @Post('advance')
  @UseGuards(PlayerDeviceGuard)
  @HttpCode(200)
  async advance(@Param('slot', ParseIntPipe) slot: number, @Headers('x-player-token') token: string, @Body() body: { playbackSession?: string }) {
    return { message: 'ok', data: await this.access.advance(slot, token, body?.playbackSession ?? '') };
  }
}
