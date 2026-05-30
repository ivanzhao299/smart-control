import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { LedAdapter } from '../../adapters/led/led.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { LedInputDto, LedPlayDto } from './dto/led.dto';
import { AdapterResult } from '../../adapters/adapter.types';

// LED 命令偏重 (开屏 / 切输入 / 推送视频), 限速 4 次/秒/客户端
@Controller('led')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 4, windowMs: 1000 })
export class LedController {
  constructor(
    private readonly led: LedAdapter,
    private readonly logService: OperationLogService,
  ) {}

  @Post(':id/on')
  on(@Param('id') id: string) {
    return this.wrap(id, 'on', () => this.led.powerOn(id));
  }

  @Post(':id/off')
  off(@Param('id') id: string) {
    return this.wrap(id, 'off', () => this.led.powerOff(id));
  }

  @Post(':id/play')
  play(@Param('id') id: string, @Body() dto: LedPlayDto) {
    return this.wrap(id, 'play', () => this.led.playMedia(id, { media: dto.media }), { media: dto.media });
  }

  @Post(':id/welcome')
  welcome(@Param('id') id: string) {
    return this.wrap(id, 'welcome', () => this.led.showWelcome(id));
  }

  @Post(':id/input')
  input(@Param('id') id: string, @Body() dto: LedInputDto) {
    return this.wrap(id, 'input', () => this.led.switchInput(id, { input: dto.input }), { input: dto.input });
  }

  private async wrap(
    id: string,
    cmd: string,
    fn: () => Promise<AdapterResult>,
    extra: Record<string, unknown> = {},
  ) {
    const result = await fn();
    await this.logService.record({
      operator: 'system',
      action: `led.${cmd}`,
      targetType: 'led',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ id, cmd, ...extra, ok: result.ok, error: result.error, durationMs: result.durationMs, mock: result.mock }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
