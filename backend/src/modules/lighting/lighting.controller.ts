import { Body, Controller, Param, ParseIntPipe, Post } from '@nestjs/common';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { ZoneBrightnessDto } from './dto/zone-brightness.dto';

@Controller('lighting')
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
