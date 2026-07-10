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

  /**
   * Sprint E (2026-05-31): 显式按 (slaveId, group) 直发 — LightZone-driven 路径.
   * 跟 setZoneBrightness 的区别: 后者用全局 group→slaveId map 推导, 同 group
   * 号在两个网关上时表达不了.
   *
   * 实现注意:
   *   - cy-dali64a / mock: 已实现
   *   - iot-gateway (RealDaliAdapter): 没实现, 调到会抛错; 现场用 cy-dali64a
   */
  setBrightnessOnGateway(
    slaveId: number,
    group: number,
    value: number,
    ctx?: AdapterContext,
  ): Promise<AdapterResult<BrightnessState & { slaveId: number; group: number }>> {
    const impl = this.impl() as unknown as {
      setBrightnessOnGateway?: (
        slaveId: number,
        group: number,
        value: number,
        ctx?: AdapterContext,
      ) => Promise<AdapterResult<BrightnessState & { slaveId: number; group: number }>>;
    };
    if (typeof impl.setBrightnessOnGateway !== 'function') {
      throw new Error(
        `当前 lighting adapter (${this.kind}) 没实现 setBrightnessOnGateway. ` +
        `只有 cy-dali64a / mock 支持. 配 LIGHTING_ADAPTER_KIND=cy-dali64a.`,
      );
    }
    return impl.setBrightnessOnGateway(slaveId, group, value, ctx);
  }

  async healthCheck(ctx?: AdapterContext): Promise<AdapterResult<{ ok: true }>> {
    return this.impl().healthCheck(ctx);
  }

  /**
   * 分层诊断 (2026-05-27): TCP → Modbus → DALI 总线一层层独立测.
   * 每层短硬超时, 失败不阻塞下一层. 远端看 backend 卡哪层一目了然.
   */
  async diagnoseLayered(): Promise<{
    diagVersion: number;
    timestamp: string;
    mode: { adapterKind: string; mockMode: boolean; effectiveImpl: string };
    config: { host: string; port: number; slaveId: number; adapterHost?: string | null; adapterPort?: number | null; hostMismatch?: boolean } | null;
    l1_tcp: { ok: boolean; elapsedMs: number; error?: string };
    l2_modbus: { ok: boolean; elapsedMs: number; error?: string };
    l3_dali: { ok: boolean; elapsedMs: number; onlineShorts: number[]; faultShorts: number[]; error?: string };
  }> {
    const out = {
      diagVersion: 1,
      timestamp: new Date().toISOString(),
      mode: {
        adapterKind: this.kind,
        mockMode: this.isMock(),
        effectiveImpl: this.isMock() || this.kind === 'mock' ? 'mock'
          : this.kind === 'iot-gateway' ? 'iot-gateway'
          : 'cy-dali64a',
      },
      config: null as { host: string; port: number; slaveId: number } | null,
      l1_tcp: { ok: false, elapsedMs: 0, error: 'not-attempted' as string | undefined },
      l2_modbus: { ok: false, elapsedMs: 0, error: 'not-attempted' as string | undefined },
      l3_dali: { ok: false, elapsedMs: 0, onlineShorts: [] as number[], faultShorts: [] as number[], error: 'not-attempted' as string | undefined },
    };

    if (out.mode.effectiveImpl !== 'cy-dali64a') {
      out.l1_tcp.error = 'skipped (not cy-dali64a)';
      out.l2_modbus.error = 'skipped (not cy-dali64a)';
      out.l3_dali.error = 'skipped (not cy-dali64a)';
      return out;
    }

    const host = process.env.DALI_RTU_HOST ?? '192.168.77.20';
    const port = Number(process.env.DALI_RTU_PORT ?? 502);
    const slaveId = Number(process.env.DALI_RTU_SLAVE_ID ?? 1);
    // 关键对比: process.env 现状 (live) vs CyDali64aAdapter 实际用的 host (起进程时锁定).
    // 如果两者不同 → backend 用着旧 IP 没刷新, 解决方案是再 admin-restart 一次.
    const adapterHost = (this.daliImpl as unknown as { getRuntimeHost?: () => string }).getRuntimeHost?.() ?? null;
    const adapterPort = (this.daliImpl as unknown as { getRuntimePort?: () => number }).getRuntimePort?.() ?? null;
    out.config = {
      host,
      port,
      slaveId,
      adapterHost,
      adapterPort,
      hostMismatch: adapterHost !== null && adapterHost !== host,
    } as { host: string; port: number; slaveId: number; adapterHost?: string | null; adapterPort?: number | null; hostMismatch?: boolean };

    // L1: 原生 net.Socket connect, 1.5s 硬超时
    const l1Start = Date.now();
    try {
      const { Socket } = await import('net');
      await new Promise<void>((resolve, reject) => {
        const sock = new Socket();
        const timer = setTimeout(() => { sock.destroy(); reject(new Error('TCP connect timed out after 1500ms')); }, 1500);
        sock.once('connect', () => { clearTimeout(timer); sock.end(); resolve(); });
        sock.once('error', (err) => { clearTimeout(timer); reject(err); });
        sock.connect(port, host);
      });
      out.l1_tcp = { ok: true, elapsedMs: Date.now() - l1Start, error: undefined };
    } catch (err) {
      out.l1_tcp = { ok: false, elapsedMs: Date.now() - l1Start, error: (err as Error).message };
      out.l2_modbus.error = 'skipped (L1 failed)';
      out.l3_dali.error = 'skipped (L1 failed)';
      return out;
    }

    // L2: Modbus ping (读 group 1 寄存器), 2s 硬超时
    const l2Start = Date.now();
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 2000);
      try { await this.daliImpl.ping({ signal: ac.signal }); } finally { clearTimeout(t); }
      out.l2_modbus = { ok: true, elapsedMs: Date.now() - l2Start, error: undefined };
    } catch (err) {
      out.l2_modbus = { ok: false, elapsedMs: Date.now() - l2Start, error: (err as Error).message };
      out.l3_dali.error = 'skipped (L2 failed)';
      return out;
    }

    // L3: DALI 总线扫描 64 短地址, 3s 硬超时
    const l3Start = Date.now();
    try {
      const ac = new AbortController();
      const t = setTimeout(() => ac.abort(), 3000);
      let online: boolean[]; let fault: boolean[];
      try {
        [online, fault] = await Promise.all([
          this.daliImpl.readOnlineMatrix(undefined, ac.signal),
          this.daliImpl.readFaultMatrix(undefined, ac.signal),
        ]);
      } finally { clearTimeout(t); }
      // out[i] = 短地址 (i+1) 的状态 — DALI 短地址 1-indexed
      out.l3_dali = {
        ok: true,
        elapsedMs: Date.now() - l3Start,
        onlineShorts: online.flatMap((on, i) => (on ? [i + 1] : [])),
        faultShorts: fault.flatMap((f, i) => (f ? [i + 1] : [])),
        error: undefined,
      };
    } catch (err) {
      out.l3_dali = {
        ok: false,
        elapsedMs: Date.now() - l3Start,
        onlineShorts: [],
        faultShorts: [],
        error: (err as Error).message,
      };
    }

    return out;
  }

  /**
   * 现场自检 (旧接口, 保留兼容): 单层探测.
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
      return out;
    }

    out.daliConfig = {
      host: process.env.DALI_RTU_HOST ?? '192.168.77.20',
      port: Number(process.env.DALI_RTU_PORT ?? 502),
      slaveId: Number(process.env.DALI_RTU_SLAVE_ID ?? 1),
    };

    const makeCtx = (ms: number): AdapterContext => {
      const ac = new AbortController();
      setTimeout(() => ac.abort(), ms).unref?.();
      return { signal: ac.signal } as AdapterContext;
    };

    try {
      await this.daliImpl.ping(makeCtx(2500));
      out.gatewayPing = { ok: true };
    } catch (err) {
      out.gatewayPing = { ok: false, error: (err as Error).message };
      return out;
    }

    try {
      const matrixCtx = makeCtx(2500);
      const [online, fault] = await Promise.all([
        this.daliImpl.readOnlineMatrix(undefined, matrixCtx.signal),
        this.daliImpl.readFaultMatrix(undefined, matrixCtx.signal),
      ]);
      // DALI 短地址是 1-indexed (parseOnlineMatrix: out[i] = 短地址 i+1)
      out.onlineShorts = online.flatMap((on, i) => (on ? [i + 1] : []));
      out.faultShorts = fault.flatMap((f, i) => (f ? [i + 1] : []));
    } catch (err) {
      out.matrixError = (err as Error).message;
    }

    return out;
  }
}
