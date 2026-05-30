import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { HvacAdapter } from '../../adapters/hvac/hvac.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { HvacFanDto, HvacModeDto, HvacTempDto } from './dto/hvac.dto';
import { AdapterResult } from '../../adapters/adapter.types';
import { findZone, HVAC_ZONES, HvacZoneConfig } from '../../adapters/hvac/hvac-zones';

// 温度按 +/- 步进调, 6 次/秒/客户端
@Controller('hvac')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 6, windowMs: 1000 })
export class HvacController {
  constructor(
    private readonly hvac: HvacAdapter,
    private readonly logService: OperationLogService,
  ) {}

  // ============ 列出所有功能区 (前端 UI / 场景配置用) ============
  @Get('zones')
  listZones() {
    return {
      message: 'OK',
      data: HVAC_ZONES,
    };
  }

  // ============ 单内机控制 (id 是 indoorIdx 字符串, 例 "1".."22") ============
  @Post(':id/on')
  on(@Param('id') id: string) {
    return this.wrap(id, 'on', () => this.hvac.turnOn(id));
  }

  @Post(':id/off')
  off(@Param('id') id: string) {
    return this.wrap(id, 'off', () => this.hvac.turnOff(id));
  }

  @Post(':id/temperature')
  temperature(@Param('id') id: string, @Body() dto: HvacTempDto) {
    return this.wrap(id, 'temperature',
      () => this.hvac.setTemperature(id, { value: dto.value }),
      { value: dto.value });
  }

  @Post(':id/mode')
  mode(@Param('id') id: string, @Body() dto: HvacModeDto) {
    return this.wrap(id, 'mode',
      () => this.hvac.setMode(id, { mode: dto.mode }),
      { mode: dto.mode });
  }

  @Post(':id/fan-speed')
  fan(@Param('id') id: string, @Body() dto: HvacFanDto) {
    return this.wrap(id, 'fan-speed',
      () => this.hvac.setFanSpeed(id, { speed: dto.speed }),
      { speed: dto.speed });
  }

  // ============ 功能区批量控制 (扇出到该区所有内机) ============
  @Post('zone/:code/on')
  zoneOn(@Param('code') code: string) {
    return this.zoneFanOut(code, 'on', (id) => this.hvac.turnOn(id));
  }

  @Post('zone/:code/off')
  zoneOff(@Param('code') code: string) {
    return this.zoneFanOut(code, 'off', (id) => this.hvac.turnOff(id));
  }

  @Post('zone/:code/temperature')
  zoneTemperature(@Param('code') code: string, @Body() dto: HvacTempDto) {
    return this.zoneFanOut(code, 'temperature',
      (id) => this.hvac.setTemperature(id, { value: dto.value }),
      { value: dto.value });
  }

  @Post('zone/:code/mode')
  zoneMode(@Param('code') code: string, @Body() dto: HvacModeDto) {
    return this.zoneFanOut(code, 'mode',
      (id) => this.hvac.setMode(id, { mode: dto.mode }),
      { mode: dto.mode });
  }

  @Post('zone/:code/fan-speed')
  zoneFan(@Param('code') code: string, @Body() dto: HvacFanDto) {
    return this.zoneFanOut(code, 'fan-speed',
      (id) => this.hvac.setFanSpeed(id, { speed: dto.speed }),
      { speed: dto.speed });
  }

  // ============ 内部: 扇出 + 聚合日志 ============
  private async zoneFanOut(
    code: string,
    cmd: string,
    fn: (indoorId: string) => Promise<AdapterResult>,
    extra: Record<string, unknown> = {},
  ) {
    const zone = findZone(code);
    if (!zone) throw new NotFoundException(`hvac zone "${code}" 不存在`);

    const results = await Promise.all(
      zone.indoors.map(async (idx) => {
        const id = String(idx);
        try {
          const r = await fn(id);
          return { indoorIdx: idx, ok: r.ok, error: r.error, durationMs: r.durationMs };
        } catch (err) {
          return { indoorIdx: idx, ok: false, error: (err as Error).message, durationMs: 0 };
        }
      }),
    );

    const okCount = results.filter(r => r.ok).length;
    const failCount = results.length - okCount;
    const ok = failCount === 0;

    await this.logService.record({
      operator: 'system',
      action: `hvac.zone.${cmd}`,
      targetType: 'hvac-zone',
      targetId: code,
      result: ok ? 'success' : 'failure',
      message: JSON.stringify({ zone: code, cmd, ...extra, okCount, failCount, partial: okCount > 0 && failCount > 0, results }),
    });

    return {
      message: ok ? '执行成功' : (okCount > 0 ? `部分成功 (${okCount}/${results.length})` : '执行失败'),
      data: {
        zone: code,
        zoneName: zone.name,
        floor: zone.floor,
        total: results.length,
        okCount,
        failCount,
        results,
      },
    };
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
      action: `hvac.${cmd}`,
      targetType: 'hvac',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ id, cmd, ...extra, ok: result.ok, error: result.error, durationMs: result.durationMs, mock: result.mock }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
