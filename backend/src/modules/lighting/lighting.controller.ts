import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { LightZonesService } from '../light-zones/light-zones.service';
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
    private readonly lightZones: LightZonesService,
  ) {}

  /**
   * Sprint E (2026-05-31): zone id 不再是 DALI group, 而是 light_zone 表 PK.
   * 路径:
   *   1) 查 LightZone 拿 (gatewayCode, daliGroup)
   *   2) gatewayCode → hardware_unit.code → addressing.slaveId
   *   3) 直接调 lighting.setBrightnessOnGateway(slaveId, group, dim)
   *
   * 这样同一 DALI group 号在不同网关上 (e.g. GW-DALI-1 group 3 vs GW-DALI-2 group 3)
   * 都能各自独立控制, 不再共用 group→slaveId 单值 map.
   */
  @Post('zone/:id/on')
  async on(@Param('id', ParseIntPipe) id: number) {
    return this.handle('on', id, async () => {
      const { zone, slaveId } = await this.lightZones.resolveForCommand(id);
      return this.lighting.setBrightnessOnGateway(slaveId, zone.daliGroup, 100);
    });
  }

  @Post('zone/:id/off')
  async off(@Param('id', ParseIntPipe) id: number) {
    return this.handle('off', id, async () => {
      const { zone, slaveId } = await this.lightZones.resolveForCommand(id);
      return this.lighting.setBrightnessOnGateway(slaveId, zone.daliGroup, 0);
    });
  }

  @Post('zone/:id/brightness')
  async brightness(@Param('id', ParseIntPipe) id: number, @Body() dto: ZoneBrightnessDto) {
    return this.handle('brightness', id, async () => {
      const { zone, slaveId } = await this.lightZones.resolveForCommand(id);
      return this.lighting.setBrightnessOnGateway(slaveId, zone.daliGroup, dto.value);
    }, { value: dto.value });
  }

  private async handle(
    cmd: string,
    zone: number,
    invoke: () => Promise<{ ok: boolean; error?: string; durationMs: number; mock: boolean; data?: unknown }>,
    extra: Record<string, unknown> = {},
  ) {
    let result: { ok: boolean; error?: string; durationMs: number; mock: boolean; data?: unknown };
    try {
      result = await invoke();
    } catch (err) {
      // resolveForCommand 抛的 NotFound/Conflict 也得包成 result, 不然返回 500 用户看不懂
      result = {
        ok: false,
        error: (err as Error).message,
        durationMs: 0,
        mock: false,
      };
    }
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
