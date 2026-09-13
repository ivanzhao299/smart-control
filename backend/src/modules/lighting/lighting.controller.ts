import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { LightZonesService } from '../light-zones/light-zones.service';
import { DaliLightsService, type LightCmd } from '../dali-lights/dali-lights.service';
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
    private readonly daliLights: DaliLightsService,
  ) {}

  @Post('zone/:id/on')
  async on(@Param('id', ParseIntPipe) id: number) {
    return this.dispatchZone('on', id, { on: true },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, 100));
  }

  @Post('zone/:id/off')
  async off(@Param('id', ParseIntPipe) id: number) {
    return this.dispatchZone('off', id, { on: false },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, 0));
  }

  @Post('zone/:id/brightness')
  async brightness(@Param('id', ParseIntPipe) id: number, @Body() dto: ZoneBrightnessDto) {
    return this.dispatchZone('brightness', id, { brightness: dto.value },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, dto.value), { value: dto.value });
  }

  /**
   * 分区控制 — **单灯优先, 硬件组回退** (2026-07-21)。
   *
   * 论断: 老路径是"对分区里每个 DALI 硬件组发组命令", 而组命令只对**已被烧进该硬件组的
   * 驱动**有效 —— 组成员关系要走网关调试口 (厂家私有协议), 我们的 Modbus 控制口做不了。
   * 现场"寻址后不分组"时硬件组是空的, 组命令打不到任何灯。而单灯软件分区 (dali_light.zoneCode)
   * 走短地址直控, 不依赖硬件组, 才是真正能用的模型。
   *
   * 所以: 分区里有单灯成员就逐灯直控; 没有单灯成员才回退到老硬件组命令 (兼容已烧组的现场)。
   * 现场把灯扫进单灯分区后, 硬件组这条线自然淡出。串行下发在 controlZone / 逐组循环里各自保证。
   */
  private async dispatchZone(
    cmd: string,
    zoneId: number,
    lightCmd: LightCmd,
    groupInvoke: (slaveId: number, daliGroup: number) => Promise<{ ok: boolean; error?: string; durationMs: number; mock: boolean }>,
    extra: Record<string, unknown> = {},
  ) {
    try {
      const { zone, targets } = await this.lightZones.resolveForCommand(zoneId);
      const zoneName = zone.name;

      // 单灯优先: 分区里有单灯成员 → 逐灯直控 (不依赖硬件组)
      const sl = await this.daliLights.controlZone(zone.code, lightCmd);
      if (sl.total > 0) {
        const ok = sl.ok === sl.total;
        await this.log(cmd, zoneId, ok, { ...extra, zone: zone.code, zoneName, mode: 'per-light', total: sl.total, okCount: sl.ok });
        return {
          message: ok ? '执行成功' : `部分成功 (${sl.ok}/${sl.total})`,
          data: { ok, zoneName, mode: 'per-light', total: sl.total, okCount: sl.ok, failCount: sl.total - sl.ok, results: [] },
        };
      }

      // 回退: 老硬件组命令 (兼容已烧硬件组的现场)
      if (targets.length === 0) {
        await this.log(cmd, zoneId, false, { ...extra, zone: zone.code, reason: 'no members' });
        return {
          message: '该分区暂无灯 (去单灯页把灯分进来)',
          data: { ok: false, zone: zone.code, zoneName, total: 0, okCount: 0, failCount: 0, results: [] },
        };
      }

      // 串行下发, 不并发: 两台 DALI 网关共用同一条 RS485, 并发帧会互相踩 (手册要求帧间隔 >=150ms)。
      const results: Array<{ gatewayCode: string; daliGroup: number; ok: boolean; error?: string }> = [];
      for (const t of targets) {
        try {
          const r = await groupInvoke(t.slaveId, t.daliGroup);
          results.push({ gatewayCode: t.gatewayCode, daliGroup: t.daliGroup, ok: r.ok, error: r.error });
        } catch (err) {
          results.push({ gatewayCode: t.gatewayCode, daliGroup: t.daliGroup, ok: false, error: (err as Error).message });
        }
      }
      const okCount = results.filter((r) => r.ok).length;
      const failCount = results.length - okCount;
      const ok = failCount === 0;
      await this.log(cmd, zoneId, ok, { ...extra, zoneName, mode: 'group', okCount, failCount, results });
      return {
        message: ok ? '执行成功' : (okCount > 0 ? `部分成功 (${okCount}/${results.length})` : '执行失败'),
        data: { ok, zoneName, mode: 'group', total: results.length, okCount, failCount, results },
      };
    } catch (err) {
      // resolveForCommand 抛的 NotFound/Conflict 也包成 data, 别返回 500 让人看不懂
      await this.log(cmd, zoneId, false, { ...extra, error: (err as Error).message });
      return {
        message: '执行失败',
        data: { ok: false, error: (err as Error).message, total: 0, okCount: 0, failCount: 0, results: [] },
      };
    }
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
