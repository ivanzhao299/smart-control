import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZoneBrightnessDto } from './dto/zone-brightness.dto';

// PERFORMANCE_AUDIT P2-#18: 设备命令限流, 防误连点堆队列
// 每秒最多 8 次/客户端: 拖动亮度滑条够用, 双击/三连击会被挡
@Controller('lighting')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 8, windowMs: 1000 })
export class LightingController {
  constructor(
    private readonly lighting: LightingAdapter,
    private readonly logService: OperationLogService,
  ) {}

  @Post('zone/:id/on')
  async on(@Param('id', ParseIntPipe) id: number) {
    return this.handle('on', id, () => this.lighting.setZoneBrightness(id, 100));
  }

  @Post('zone/:id/off')
  async off(@Param('id', ParseIntPipe) id: number) {
    return this.handle('off', id, () => this.lighting.setZoneBrightness(id, 0));
  }

  @Post('zone/:id/brightness')
  async brightness(@Param('id', ParseIntPipe) id: number, @Body() dto: ZoneBrightnessDto) {
    return this.handle('brightness', id, () => this.lighting.setZoneBrightness(id, dto.value), {
      value: dto.value,
    });
  }

  private async handle(
    cmd: string,
    zone: number,
    invoke: () => Promise<{ ok: boolean; error?: string; durationMs: number; mock: boolean; data?: unknown }>,
    extra: Record<string, unknown> = {},
  ) {
    const result = await invoke();
    await this.logService.record({
      operator: 'system',
      action: `lighting.zone.${cmd}`,
      targetType: 'lighting-zone',
      targetId: String(zone),
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ zone, cmd, ...extra, ok: result.ok, error: result.error, durationMs: result.durationMs, mock: result.mock }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
