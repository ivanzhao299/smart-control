import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { LightingAdapter } from '../adapters/lighting/lighting.adapter';
import { LedAdapter } from '../adapters/led/led.adapter';
import { AudioAdapter } from '../adapters/audio/audio.adapter';
import { HvacAdapter } from '../adapters/hvac/hvac.adapter';
import { PowerAdapter } from '../adapters/power/power.adapter';
import { AdapterContext, AdapterResult } from '../adapters/adapter.types';
import { DeviceStatusService } from './device-status.service';

export interface DispatchInput {
  deviceType: string;
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
}

@Injectable()
export class CommandDispatcherService {
  constructor(
    private readonly lighting: LightingAdapter,
    private readonly led: LedAdapter,
    private readonly audio: AudioAdapter,
    private readonly hvac: HvacAdapter,
    private readonly power: PowerAdapter,
    private readonly deviceStatus: DeviceStatusService,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async dispatch(input: DispatchInput, ctx?: AdapterContext): Promise<AdapterResult> {
    const params = input.params ?? {};
    const result = await this.invoke(input.deviceType, input.command, input.deviceId, params, ctx);

    if (result.ok) {
      await this.deviceStatus.update(
        input.deviceId,
        'running',
        { lastCommand: input.command, lastResult: result.data ?? null },
        false,
      );
    } else {
      await this.deviceStatus.update(
        input.deviceId,
        'error',
        { lastCommand: input.command, error: result.error },
        false,
      );
    }
    return result;
  }

  private invoke(
    deviceType: string,
    command: string,
    deviceId: string,
    params: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (deviceType) {
      case 'lighting':
        return this.callLighting(command, deviceId, params, ctx);
      case 'led':
        return this.callLed(command, deviceId, params, ctx);
      case 'audio':
        return this.callAudio(command, deviceId, params, ctx);
      case 'hvac':
        return this.callHvac(command, deviceId, params, ctx);
      case 'hvac-zone':
        return this.callHvacZone(command, deviceId, params, ctx);
      case 'power':
        return this.callPower(command, deviceId, params, ctx);
      default:
        throw new BadRequestException(`未知设备类型: ${deviceType}`);
    }
  }

  private callLighting(
    cmd: string,
    id: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (cmd) {
      case 'turnOn':
        return this.lighting.turnOn(id, p, ctx);
      case 'turnOff':
        return this.lighting.turnOff(id, p, ctx);
      case 'setBrightness':
        return this.lighting.setBrightness(id, p as { value?: number }, ctx);
      case 'recallScene':
        return this.lighting.recallScene(id, p as { scene?: string | number }, ctx);
      case 'getStatus':
        return this.lighting.getStatus(id, ctx);
      default:
        return this.unsupported('lighting', cmd, id);
    }
  }

  private callLed(
    cmd: string,
    id: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (cmd) {
      case 'powerOn':
        return this.led.powerOn(id, p, ctx);
      case 'powerOff':
        return this.led.powerOff(id, p, ctx);
      case 'switchInput':
        return this.led.switchInput(id, p as Parameters<typeof this.led.switchInput>[1], ctx);
      case 'play':
      case 'playMedia':
        return this.led.playMedia(id, p as { media?: string; channel?: string }, ctx);
      case 'showWelcome':
        return this.led.showWelcome(id, p, ctx);
      case 'getStatus':
        return this.led.getStatus(id, ctx);
      default:
        return this.unsupported('led', cmd, id);
    }
  }

  private callAudio(
    cmd: string,
    id: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (cmd) {
      case 'setVolume':
        return this.audio.setVolume(id, p as { value?: number }, ctx);
      case 'mute':
        return this.audio.mute(id, p, ctx);
      case 'unmute':
        return this.audio.unmute(id, p, ctx);
      case 'play':
      case 'playBgm':
        return this.audio.playBgm(id, p as { track?: string; channel?: string; zone?: string }, ctx);
      case 'stop':
      case 'stopBgm':
        return this.audio.stopBgm(id, p as { zone?: string }, ctx);
      case 'enableMic':
        return this.audio.enableMic(id, p as { enable?: boolean; zone?: string }, ctx);
      default:
        return this.unsupported('audio', cmd, id);
    }
  }

  private callHvac(
    cmd: string,
    id: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (cmd) {
      case 'turnOn':
        return this.hvac.turnOn(id, p, ctx);
      case 'turnOff':
        return this.hvac.turnOff(id, p, ctx);
      case 'setTemperature':
        return this.hvac.setTemperature(id, p as { value?: number; temperature?: number }, ctx);
      case 'setMode':
        return this.hvac.setMode(id, p as { mode?: 'cool' | 'heat' | 'fan' | 'auto' | 'dry' }, ctx);
      case 'setFanSpeed':
        return this.hvac.setFanSpeed(id, p as { speed?: 'auto' | 'low' | 'mid' | 'high' }, ctx);
      case 'getStatus':
        return this.hvac.getStatus(id, ctx);
      default:
        return this.unsupported('hvac', cmd, id);
    }
  }

  /**
   * 场景动作 hvac-zone: 把单个 zone 操作扇出到该区所有内机.
   * deviceId = zone code (例: "roadshow", "meeting_room").
   * 命令同 hvac (turnOn / turnOff / setTemperature / setMode / setFanSpeed).
   * 任一内机失败 → 整个 zone action 标 ok=false (与单机一致, scene engine 会重试整组).
   */
  private async callHvacZone(
    cmd: string,
    zoneCode: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    // 动态 import 避免循环依赖
    const { findZone } = await import('../adapters/hvac/hvac-zones');
    const zone = findZone(zoneCode);
    if (!zone) {
      return this.unsupported('hvac-zone', cmd, zoneCode);
    }
    const started = Date.now();
    const results = await Promise.all(zone.indoors.map(idx => this.callHvac(cmd, String(idx), p, ctx)));
    const okCount = results.filter(r => r.ok).length;
    const ok = okCount === results.length;
    return {
      ok,
      deviceId: zoneCode,
      command: cmd,
      mock: results.every(r => r.mock),
      durationMs: Date.now() - started,
      data: { zoneCode, zoneName: zone.name, total: results.length, okCount, results },
      error: ok ? undefined : `${results.length - okCount}/${results.length} 内机失败`,
    };
  }

  private callPower(
    cmd: string,
    id: string,
    p: Record<string, unknown>,
    ctx?: AdapterContext,
  ): Promise<AdapterResult> {
    switch (cmd) {
      case 'turnOn':
        return this.power.turnOn(id, p, ctx);
      case 'turnOff':
        return this.power.turnOff(id, p, ctx);
      case 'getStatus':
        return this.power.getStatus(id, ctx);
      default:
        return this.unsupported('power', cmd, id);
    }
  }

  private unsupported(type: string, cmd: string, id: string): Promise<AdapterResult> {
    this.logger.warn(`Unsupported command: ${type}.${cmd} on ${id}`, {
      context: 'CommandDispatcher',
    });
    return Promise.resolve({
      ok: false,
      deviceId: id,
      command: cmd,
      error: `unsupported command: ${type}.${cmd}`,
      mock: false,
      durationMs: 0,
    });
  }
}
