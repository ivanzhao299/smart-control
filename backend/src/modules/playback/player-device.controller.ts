import { Controller, Post, Param, ParseIntPipe, UseGuards, HttpCode } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PlayerDeviceGuard } from './player-device.guard';
import { PlaybackService } from './playback.service';

/** Public skips USER auth only; every route still requires scoped DEVICE auth. */
@Public()
@UseGuards(PlayerDeviceGuard)
@Controller('player-device/:slot')
export class PlayerDeviceController {
  constructor(private readonly playback: PlaybackService) {}

  @Post('heartbeat')
  @HttpCode(200)
  async heartbeat(@Param('slot', ParseIntPipe) slot: number) {
    await this.playback.heartbeat(slot);
    return { message: 'ok', data: null };
  }
}
