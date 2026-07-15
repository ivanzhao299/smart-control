import { Body, Controller, Get, NotFoundException, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { HvacAdapter } from '../../adapters/hvac/hvac.adapter';
import { ModbusHvacAdapter } from '../../adapters/hvac/modbus-hvac.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { HvacFanDto, HvacModeDto, HvacTempDto, HvacZoneRenameDto } from './dto/hvac.dto';
import { AdapterResult } from '../../adapters/adapter.types';
import { findZone, HVAC_ZONES, HvacZoneConfig } from '../../adapters/hvac/hvac-zones';
import { HvacZone } from '../../entities/hvac-zone.entity';

// 温度按 +/- 步进调, 6 次/秒/客户端
@Controller('hvac')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 6, windowMs: 1000 })
export class HvacController {
  constructor(
    private readonly hvac: HvacAdapter,
    private readonly modbusHvac: ModbusHvacAdapter,
    private readonly logService: OperationLogService,
    @InjectRepository(HvacZone) private readonly zoneRepo: Repository<HvacZone>,
  ) {}

  /**
   * 列出所有功能区 (前端 UI / 场景配置用).
   *
   * 数据源是 hvac_zone 表 (业主可在前端改名); 表为空时 (首次启动/新库) 用
   * HVAC_ZONES 常量灌入一次, 之后就以库为准。code 幂等, 不会覆盖改过的名字。
   */
  @Get('zones')
  async listZones() {
    const rows = await this.ensureZonesSeeded();
    const data: HvacZoneConfig[] = rows.map((z) => ({
      code: z.code,
      name: z.name,
      floor: z.floor as '1F' | '2F',
      indoors: this.parseIndoors(z.indoors),
      desc: z.description ?? undefined,
    }));
    return { message: 'OK', data };
  }

  /**
   * 改功能区名字 — 业主在 PWA 空调页直接点区名改, 不用进后台。
   * PUT /api/hvac/zones/:code  { name: "新名字" }
   */
  @Put('zones/:code')
  @RateLimit({ max: 10, windowMs: 5000 })
  async renameZone(@Param('code') code: string, @Body() dto: HvacZoneRenameDto) {
    await this.ensureZonesSeeded();
    const zone = await this.zoneRepo.findOne({ where: { code } });
    if (!zone) throw new NotFoundException(`hvac zone "${code}" 不存在`);
    const oldName = zone.name;
    zone.name = dto.name.trim();
    const saved = await this.zoneRepo.save(zone);
    await this.logService.record({
      operator: 'client',
      action: 'hvac.zone.rename',
      targetType: 'hvac-zone',
      targetId: code,
      result: 'success',
      message: JSON.stringify({ from: oldName, to: saved.name }),
    });
    return {
      message: '已更名',
      data: { code: saved.code, name: saved.name, floor: saved.floor, indoors: this.parseIndoors(saved.indoors) },
    };
  }

  /** 表空则用 HVAC_ZONES 常量灌一次 (幂等: 已存在的 code 不动, 保留业主改的名字) */
  private async ensureZonesSeeded(): Promise<HvacZone[]> {
    const existing = await this.zoneRepo.find({ where: { enabled: true }, order: { floor: 'ASC', sortOrder: 'ASC' } });
    if (existing.length > 0) return existing;
    const seeded = HVAC_ZONES.map((z, i) =>
      this.zoneRepo.create({
        code: z.code,
        name: z.name,
        floor: z.floor,
        indoors: JSON.stringify(z.indoors),
        sortOrder: (i + 1) * 10,
        description: z.desc ?? null,
        enabled: true,
      }),
    );
    await this.zoneRepo.save(seeded);
    return this.zoneRepo.find({ where: { enabled: true }, order: { floor: 'ASC', sortOrder: 'ASC' } });
  }

  private parseIndoors(json: string): number[] {
    try {
      const a = JSON.parse(json) as unknown;
      return Array.isArray(a) ? a.filter((x): x is number => typeof x === 'number') : [];
    } catch {
      return [];
    }
  }

  /**
   * 扫描网关实际挂载的内机 — 现场调试 / 校准配置用.
   *
   * 中弘网关单客户端, 后端占着连接时外部工具连不进去, 所以扫描必须走后端。
   * 返回每台网关自报的内机数量 + 真实在线的内机号 (现场编号可能不从 0 开始)。
   * 用来核对 devices 表里配的 n 跟现场是否一致。
   *
   * GET /api/hvac/gateways/scan?maxIndoor=16
   */
  @Get('gateways/scan')
  async scanGateways(@Query('maxIndoor') maxIndoor?: string) {
    const max = Math.min(Math.max(Number.parseInt(maxIndoor ?? '16', 10) || 16, 1), 63);
    const data = await this.modbusHvac.scanAllGateways(max);
    return { message: 'OK', data };
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
    // 走 DB (业主改过的名字/成员生效); 库里没有再回退到常量
    const row = await this.zoneRepo.findOne({ where: { code } });
    const zone: HvacZoneConfig | undefined = row
      ? { code: row.code, name: row.name, floor: row.floor as '1F' | '2F', indoors: this.parseIndoors(row.indoors) }
      : findZone(code);
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
