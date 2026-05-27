import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { BaseAdapter } from '../base.adapter';
import { AdapterContext, AdapterResult } from '../adapter.types';
import { MockDaliAdapter, BrightnessState } from './mock-dali.adapter';
import { RealDaliAdapter } from './real-dali.adapter';
import { CyDali64aAdapter } from './cy-dali64a.adapter';

/**
 * LIGHTING_ADAPTER_KIND env 控制真实模式下的实现:
 *   - 'cy-dali64a' (默认) : 元创智控 CY-DALI64A, 走 Modbus RTU over TCP
 *   - 'iot-gateway'       : 通用 HTTP REST DALI IoT Gateway (现有 RealDaliAdapter)
 *   - 'mock'              : 强制 mock (即使 MOCK_MODE=false)
 */
type LightingKind = 'mock' | 'cy-dali64a' | 'iot-gateway';

function readLightingKind(): LightingKind {
  const v = (process.env.LIGHTING_ADAPTER_KIND ?? '').trim().toLowerCase();
  if (v === 'iot-gateway' || v === 'http' || v === 'rest') return 'iot-gateway';
  if (v === 'mock') return 'mock';
  return 'cy-dali64a'; // 默认走真实硬件 (现场用 CY-DALI64A)
}

type AnyDaliImpl = MockDaliAdapter | RealDaliAdapter | CyDali64aAdapter;

@Injectable()
export class LightingAdapter extends BaseAdapter {
  get deviceType(): string {
    return 'lighting';
  }

  private readonly kind: LightingKind;

  constructor(
    config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER) logger: Logger,
    private readonly mockImpl: MockDaliAdapter,
    private readonly realImpl: RealDaliAdapter,
    private readonly daliImpl: CyDali64aAdapter,
  ) {
    super(config, logger);
    this.kind = readLightingKind();
    const mode = this.isMock() ? 'mock' : this.kind === 'mock' ? 'mock(forced)' : this.kind;
    this.logger.info(`LightingAdapter ready (mode=${mode})`, { context: 'LightingAdapter' });
  }

  private impl(): AnyDaliImpl {
    if (this.isMock()) return this.mockImpl;
    if (this.kind === 'mock') return this.mockImpl;
    if (this.kind === 'iot-gateway') return this.realImpl;
    return this.daliImpl;
  }

  turnOn(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().turnOn(deviceId, params, ctx);
  }

  turnOff(deviceId: string, params: Record<string, unknown> = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().turnOff(deviceId, params, ctx);
  }

  setBrightness(deviceId: string, params: { value?: number } = {}, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().setBrightness(deviceId, params, ctx);
  }

  recallScene(
    deviceId: string,
    params: { scene?: string | number } = {},
    ctx?: AdapterContext,
  ): Promise<AdapterResult<{ scene: string | number } | { scene: number }>> {
    return this.impl().recallScene(deviceId, params, ctx);
  }

  getStatus(deviceId: string, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState>> {
    return this.impl().getStatus(deviceId, ctx);
  }

  setZoneBrightness(zoneId: number, value: number, ctx?: AdapterContext): Promise<AdapterResult<BrightnessState & { zone: number }>> {
    return this.impl().setZoneBrightness(zoneId, value, ctx);
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }

  /**
   * 现场自检: 返回当前 adapter 模式 + (cy-dali64a 真实模式下) DALI 总线上探到的设备列表.
   * 用于"我在 Mac 上能不能知道 GK9000 接的 DALI 灯通不通". 不抛错, 失败信息进 result.error.
   */
  async selfDiagnose(ctx?: AdapterContext): Promise<{
    adapterKind: LightingKind;
    mockMode: boolean;
    effectiveImpl: 'mock' | 'cy-dali64a' | 'iot-gateway';
    gatewayPing: { ok: boolean; error?: string };
    onlineShorts: number[] | null;
    faultShorts: number[] | null;
    matrixError?: string;
    daliConfig?: { host: string; port: number; slaveId: number };
    timestamp: string;
  }> {
    const mockMode = this.isMock();
    const effective: 'mock' | 'cy-dali64a' | 'iot-gateway' =
      mockMode || this.kind === 'mock' ? 'mock'
      : this.kind === 'iot-gateway' ? 'iot-gateway'
      : 'cy-dali64a';

    const out = {
      adapterKind: this.kind,
      mockMode,
      effectiveImpl: effective,
      gatewayPing: { ok: false } as { ok: boolean; error?: string },
      onlineShorts: null as number[] | null,
      faultShorts: null as number[] | null,
      matrixError: undefined as string | undefined,
      daliConfig: undefined as { host: string; port: number; slaveId: number } | undefined,
      timestamp: new Date().toISOString(),
    };

    if (effective !== 'cy-dali64a') {
      // mock 或 iot-gateway: 不做实际硬件探测
      return out;
    }

    out.daliConfig = {
      host: process.env.DALI_RTU_HOST ?? '192.168.50.20',
      port: Number(process.env.DALI_RTU_PORT ?? 502),
      slaveId: Number(process.env.DALI_RTU_SLAVE_ID ?? 1),
    };

    try {
      await this.daliImpl.ping(ctx);
      out.gatewayPing = { ok: true };
    } catch (err) {
      out.gatewayPing = { ok: false, error: (err as Error).message };
      // 网关都连不上, 矩阵没意义, 直接返回
      return out;
    }

    try {
      const [online, fault] = await Promise.all([
        this.daliImpl.readOnlineMatrix(undefined, ctx?.signal),
        this.daliImpl.readFaultMatrix(undefined, ctx?.signal),
      ]);
      // 矩阵下标 0..63 → DALI 短地址 0..63 (按厂家文档)
      out.onlineShorts = online.flatMap((on, i) => (on ? [i] : []));
      out.faultShorts = fault.flatMap((f, i) => (f ? [i] : []));
    } catch (err) {
      out.matrixError = (err as Error).message;
    }

    return out;
  }
}
