import { Body, Controller, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { LightZonesService } from '../light-zones/light-zones.service';
import { DaliLightsService, type LightCmd } from '../dali-lights/dali-lights.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { ZoneBrightnessDto } from './dto/zone-brightness.dto';

/**
 * 硬件组同步开关 (路径A, 2026-10-10):
 *   LIGHTING_HW_GROUP_SYNC 控制分区命令走哪条:
 *     'auto' (默认): 分区登记了 DALI 硬件组 -> 一条组命令整组同步; 没组 -> 逐灯回退.
 *     'on'          : 只走硬件组命令 (无组直接报错).
 *     'off'         : 只走逐灯 (2026-07 的老行为, 出问题时的一键回退).
 *
 *   现场用厂家 DALI 配置工具把灯编入硬件组后, 系统在 auto 下自动改发组命令,
 *   无需再改代码; 组命令让总线上该组所有灯在同一时刻开始 fade, 真正同步、负载最低.
 */
type HwSyncMode = 'auto' | 'on' | 'off';

function readHwSyncMode(): HwSyncMode {
  const v = (process.env.LIGHTING_HW_GROUP_SYNC ?? 'auto').trim().toLowerCase();
  if (v === 'on' || v === 'true' || v === 'force') return 'on';
  if (v === 'off' || v === 'false') return 'off';
  return 'auto';
}

/** 分区开/关/调光统一渐变时长 (秒), 默认 2s; 配 0 = 立即(硬切). */
function readZoneFadeSec(): number {
  const n = Number.parseFloat(process.env.LIGHTING_ZONE_FADE_SEC ?? '2');
  return Number.isFinite(n) && n >= 0 ? n : 2;
}

// PERFORMANCE_AUDIT P2-#18: 设备命令限流, 防误连点堆队列
// 每秒最多 8 次/客户端: 拖动亮度滑条够用, 双击/三连击会被挡
@Controller('lighting')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 8, windowMs: 1000 })
export class LightingController {
  private readonly hwSyncMode: HwSyncMode = readHwSyncMode();
  private readonly zoneFadeSec: number = readZoneFadeSec();

  constructor(
    private readonly lighting: LightingAdapter,
    private readonly logService: OperationLogService,
    private readonly lightZones: LightZonesService,
    private readonly daliLights: DaliLightsService,
  ) {}

  @Post('zone/:id/on')
  async on(@Param('id', ParseIntPipe) id: number) {
    return this.dispatchZone('on', id, { on: true, fadeSec: this.zoneFadeSec },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, 100, this.zoneFadeSec));
  }

  @Post('zone/:id/off')
  async off(@Param('id', ParseIntPipe) id: number) {
    return this.dispatchZone('off', id, { on: false, fadeSec: this.zoneFadeSec },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, 0, this.zoneFadeSec));
  }

  @Post('zone/:id/brightness')
  async brightness(@Param('id', ParseIntPipe) id: number, @Body() dto: ZoneBrightnessDto) {
    return this.dispatchZone('brightness', id, { brightness: dto.value, fadeSec: this.zoneFadeSec },
      (slaveId, group) => this.lighting.setBrightnessOnGateway(slaveId, group, dto.value, this.zoneFadeSec),
      { value: dto.value });
  }

  /**
   * 分区控制 — **硬件组同步优先, 逐灯回退** (2026-10-10 路径A)。
   *
   * 背景: DALI 让一组灯"同一时刻开始渐变"的方式是一条硬件组命令; 组成员关系存在每个
   * 驱动里, 由厂家 DALI 配置工具写入 (Modbus 控制口只能发命令、不能配分组)。现场已用
   * 厂家工具分组, 并在 light_group 表登记了 (网关, 组号) → 分区。
   *
   * 路由 (hwSyncMode):
   *   auto: resolveForCommand 有 targets(硬件组) -> 逐组发一条带 fade 的组命令 (组内硬件同步);
   *         没 targets -> 逐短地址直控 (dali_light.zoneCode)。
   *   on : 只走硬件组; 无组报错。
   *   off: 只走逐灯 (老行为, 回退用)。
   *
   * 一条分区含多个硬件组时, 逐组串行 (共用一条 RS485, 并发 Modbus 帧会互踩, 手册要求
   * 帧间隔 >=150ms); 但组数远少于灯数, 整分区在数百 ms 内全部开始, 且每组内部硬件同步。
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
      const hasGroups = targets.length > 0;

      const useGroup =
        this.hwSyncMode === 'on' || (this.hwSyncMode === 'auto' && hasGroups);

      // ===== 硬件组同步路径 =====
      if (useGroup) {
        if (!hasGroups) {
          await this.log(cmd, zoneId, false, { ...extra, zone: zone.code, zoneName, reason: 'no groups' });
          return {
            message: '该分区暂无灯组 (去分区页编组, 或把 LIGHTING_HW_GROUP_SYNC 设 auto)',
            data: { ok: false, zone: zone.code, zoneName, total: 0, okCount: 0, failCount: 0, results: [] },
          };
        }

        // 逐硬件组串行: 每组一条带统一 fade 的组命令, 组内所有灯 DALI 硬件同步淡入淡出.
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
        await this.log(cmd, zoneId, ok, { ...extra, zone: zone.code, zoneName, mode: 'hw-group', groups: targets.length, okCount, failCount, fadeSec: this.zoneFadeSec, results });
        return {
          message: ok ? '执行成功' : (okCount > 0 ? `部分成功 (${okCount}/${results.length})` : '执行失败'),
          data: { ok, zoneName, mode: 'hw-group', total: results.length, okCount, failCount, results },
        };
      }

      // ===== 逐灯回退路径 (auto 无组 / off) =====
      const sl = await this.daliLights.controlZone(zone.code, lightCmd);
      if (sl.total > 0) {
        const ok = sl.ok === sl.total;
        await this.log(cmd, zoneId, ok, { ...extra, zone: zone.code, zoneName, mode: 'per-light', total: sl.total, okCount: sl.ok });
        return {
          message: ok ? '执行成功' : `部分成功 (${sl.ok}/${sl.total})`,
          data: { ok, zoneName, mode: 'per-light', total: sl.total, okCount: sl.ok, failCount: sl.total - sl.ok, results: [] },
        };
      }

      // 既无硬件组也无单灯
      await this.log(cmd, zoneId, false, { ...extra, zone: zone.code, zoneName, reason: 'no members' });
      return {
        message: '该分区暂无灯 (去单灯页把灯分进来, 或用厂家工具配置硬件组)',
        data: { ok: false, zone: zone.code, zoneName, total: 0, okCount: 0, failCount: 0, results: [] },
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
