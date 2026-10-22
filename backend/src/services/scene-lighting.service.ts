import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LightingAdapter } from '../adapters/lighting/lighting.adapter';
import { AdapterContext, AdapterResult } from '../adapters/adapter.types';
import { LightGroup } from '../entities/light-group.entity';
import { HardwareUnit } from '../entities/hardware-unit.entity';

export interface BroadcastBrightnessResult {
  total: number;
  succeeded: number;
  failed: number;
  groups: Array<{
    gatewayCode: string;
    daliGroup: number;
    ok: boolean;
    error?: string;
  }>;
}

/**
 * 场景专用的 DALI 全量动作。
 *
 * 电源回路和 DALI 分组是两层设备：场景先按顺序打开真实电源回路，
 * 再由这里读取当前启用的全部 DALI 分组统一介入。分组目录变化时不需要
 * 再修改场景动作，也不会把某一路远程电源错误地绑定到单个 DALI 组。
 */
@Injectable()
export class SceneLightingService {
  constructor(
    @InjectRepository(LightGroup) private readonly groupRepo: Repository<LightGroup>,
    @InjectRepository(HardwareUnit) private readonly hardwareRepo: Repository<HardwareUnit>,
    private readonly lighting: LightingAdapter,
  ) {}

  async setAllBrightness(
    value: number,
    fadeSec: number | undefined,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BroadcastBrightnessResult>> {
    const target = Math.max(0, Math.min(100, Math.round(value)));
    const groups = await this.groupRepo.find({
      where: { enabled: true },
      order: { gatewayCode: 'ASC', daliGroup: 'ASC' },
    });
    const gatewayCodes = [...new Set(groups.map((group) => group.gatewayCode))];
    const hardware = await this.hardwareRepo.find({ where: gatewayCodes.map((code) => ({ code })) });
    const slaveIds = new Map<string, number>();
    for (const unit of hardware) {
      try {
        slaveIds.set(unit.code, this.slaveIdOf(unit.addressing, unit.code));
      } catch {
        // The group result below carries the actionable configuration error.
      }
    }
    const results = await Promise.all(groups.map(async (group) => {
      const slaveId = slaveIds.get(group.gatewayCode);
      try {
        if (!slaveId) throw new Error(`DALI 网关未配置 slaveId: ${group.gatewayCode}`);
        const result = await this.lighting.setBrightnessOnGateway(
          slaveId,
          group.daliGroup,
          target,
          fadeSec,
          ctx,
        );
        return {
          gatewayCode: group.gatewayCode,
          daliGroup: group.daliGroup,
          ok: result.ok,
          error: result.error,
        };
      } catch (error) {
        return {
          gatewayCode: group.gatewayCode,
          daliGroup: group.daliGroup,
          ok: false,
          error: (error as Error).message,
        };
      }
    }));
    const succeeded = results.filter((result) => result.ok).length;
    const failed = results.length - succeeded;
    return {
      ok: failed === 0,
      deviceId: 'all-dali-groups',
      command: 'setBrightness',
      mock: false,
      durationMs: 0,
      data: { total: results.length, succeeded, failed, groups: results },
      error: failed === 0 ? undefined : `${failed}/${results.length} 个 DALI 分组失败`,
    };
  }

  private slaveIdOf(addressing: string | null, gatewayCode: string): number {
    try {
      const parsed = addressing ? JSON.parse(addressing) as { slaveId?: unknown } : null;
      const slaveId = Number(parsed?.slaveId);
      if (Number.isInteger(slaveId) && slaveId > 0) return slaveId;
    } catch {
      // Keep the error tied to the hardware code below.
    }
    throw new Error(`DALI 网关 addressing 未配置 slaveId: ${gatewayCode}`);
  }
}
