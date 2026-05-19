import { Body, Controller, Param, Post } from '@nestjs/common';
import { HvacAdapter } from '../../adapters/hvac/hvac.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { HvacFanDto, HvacModeDto, HvacTempDto } from './dto/hvac.dto';
import { AdapterResult } from '../../adapters/adapter.types';

@Controller('hvac')
export class HvacController {
  constructor(
    private readonly hvac: HvacAdapter,
    private readonly logService: OperationLogService,
  ) {}

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
