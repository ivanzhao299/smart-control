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
   * 分区控制 — **扇出到该分区的每一个 DALI 组**.
   *
   * 2026-07-16 改造: 现场 7 个分区 / 11 个组, 一个分区可以由多组灯拼成
   * (业主: "有的多组灯放在一个分区"), 而且**可能横跨两台网关** —— 组号在网关间
   * 会重复 (两台都有"组3"、却是完全不同的灯), 所以每个目标必须带自己的 slaveId,
   * 光传组号必错。resolveForCommand 返回的就是 (slaveId, daliGroup) 列表。
   *
   * 之前是单组逻辑 (zone.daliGroup 单值), 一个分区只点得亮一组灯。
   */
  @Post('zone/:id/on')
  async on(@Param('id', ParseIntPipe) id: number) {
    return this.fanOut('on', id, (slaveId, group) =>
      this.lighting.setBrightnessOnGateway(slaveId, group, 100));
  }

  @Post('zone/:id/off')
  async off(@Param('id', ParseIntPipe) id: number) {
    return this.fanOut('off', id, (slaveId, group) =>
      this.lighting.setBrightnessOnGateway(slaveId, group, 0));
  }

  @Post('zone/:id/brightness')
  async brightness(@Param('id', ParseIntPipe) id: number, @Body() dto: ZoneBrightnessDto) {
    return this.fanOut('brightness', id, (slaveId, group) =>
      this.lighting.setBrightnessOnGateway(slaveId, group, dto.value), { value: dto.value });
  }

  /**
   * 对分区里每个组下发同一条命令, 聚合成功/失败.
   *
   * 串行下发, 不并发: 两台 DALI 网关共用同一条 RS485 / 同一个有人转换器, 并发帧会
   * 互相踩 (CY-DALI64A 手册要求帧间隔 >=150ms)。宁可慢, 不要丢帧。
   */
  private async fanOut(
    cmd: string,
    zoneId: number,
    invoke: (slaveId: number, daliGroup: number) => Promise<{ ok: boolean; error?: string; durationMs: number; mock: boolean }>,
    extra: Record<string, unknown> = {},
  ) {
    let zoneName = '';
    const results: Array<{ gatewayCode: string; daliGroup: number; ok: boolean; error?: string }> = [];
    try {
      const { zone, targets } = await this.lightZones.resolveForCommand(zoneId);
      zoneName = zone.name;

      if (targets.length === 0) {
        // 空分区不是故障 (业主可能刚建了分区还没往里放组), 但也别假装执行成功
        await this.log(cmd, zoneId, false, { ...extra, zone: zone.code, reason: 'no groups' });
        return {
          message: '该分区暂无灯组',
          data: { ok: false, zone: zone.code, zoneName, total: 0, okCount: 0, failCount: 0, results: [] },
        };
      }

      for (const t of targets) {
        try {
          const r = await invoke(t.slaveId, t.daliGroup);
          results.push({ gatewayCode: t.gatewayCode, daliGroup: t.daliGroup, ok: r.ok, error: r.error });
        } catch (err) {
          results.push({
            gatewayCode: t.gatewayCode, daliGroup: t.daliGroup,
            ok: false, error: (err as Error).message,
          });
        }
      }
    } catch (err) {
      // resolveForCommand 抛的 NotFound/Conflict 也包成 data, 别返回 500 让人看不懂
      await this.log(cmd, zoneId, false, { ...extra, error: (err as Error).message });
      return {
        message: '执行失败',
        data: { ok: false, error: (err as Error).message, total: 0, okCount: 0, failCount: 0, results: [] },
      };
    }

    const okCount = results.filter((r) => r.ok).length;
    const failCount = results.length - okCount;
    const ok = failCount === 0;
    await this.log(cmd, zoneId, ok, { ...extra, zoneName, okCount, failCount, results });
    return {
      message: ok ? '执行成功' : (okCount > 0 ? `部分成功 (${okCount}/${results.length})` : '执行失败'),
      data: { ok, zoneName, total: results.length, okCount, failCount, results },
    };
  }

  private async log(cmd: string, zoneId: number, ok: boolean, payload: Record<string, unknown>) {
    await this.logService.record({
      operator: 'system',
      action: `lighting.zone.${cmd}`,
      targetType: 'lighting-zone',
      targetId: String(zoneId),
      result: ok ? 'success' : 'failure',
      message: JSON.stringify({ zone: zoneId, cmd, ...payload }),
    });
  }
}
