import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LightingAdapter } from '../adapters/lighting/lighting.adapter';
import { LedAdapter } from '../adapters/led/led.adapter';
import { AudioAdapter } from '../adapters/audio/audio.adapter';
import { HvacAdapter } from '../adapters/hvac/hvac.adapter';
import { PowerAdapter } from '../adapters/power/power.adapter';
import { AdapterContext, AdapterResult } from '../adapters/adapter.types';
import { DeviceStatusService } from './device-status.service';
import { HvacZone } from '../entities/hvac-zone.entity';
import { HvacIndoor } from '../entities/hvac-indoor.entity';
import { DeviceStatus } from '../entities/device.entity';
import {
  classifyError,
  DeviceConnectionError,
  DeviceOfflineError,
  DeviceTimeoutError,
} from '../adapters/errors';

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
    @InjectRepository(HvacZone) private readonly hvacZoneRepo: Repository<HvacZone>,
    @InjectRepository(HvacIndoor) private readonly hvacIndoorRepo: Repository<HvacIndoor>,
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
        this.failureStatus(result.error),
        { lastCommand: input.command, error: result.error },
        false,
      );
    }
    return result;
  }

  /**
   * 命令失败时的设备状态: 连接被拒 / 超时 / 主机或网络不可达等"连不上"的情况归为
   * 'offline' —— 这是设备断电或离线的真实语义, 不计入后台"需排查"; 只有设备已经
   * 连通、却返回协议错误或业务失败, 才归为 'error'(真正需要排查的故障)。
   */
  private failureStatus(error: string | undefined): DeviceStatus {
    const classified = classifyError('dispatch', new Error(String(error ?? '')));
    if (
      classified instanceof DeviceConnectionError ||
      classified instanceof DeviceTimeoutError ||
      classified instanceof DeviceOfflineError
    ) {
      return 'offline';
    }
    return 'error';
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
    const zone = await this.hvacZoneRepo.findOne({ where: { code: zoneCode, enabled: true } });
    if (!zone) return this.unsupported('hvac-zone', cmd, zoneCode);
    const indoors = await this.hvacIndoorRepo.find({
      where: { zoneCode, enabled: true },
      order: { idx: 'ASC' },
    });
    if (indoors.length === 0) {
      return {
        ok: false,
        deviceId: zoneCode,
        command: cmd,
        mock: false,
        durationMs: 0,
        data: { zoneCode, zoneName: zone.name, total: 0, okCount: 0, results: [] },
        error: '功能区暂无内机',
      };
    }
    const started = Date.now();
    const results = await Promise.all(indoors.map(indoor => this.callHvac(cmd, String(indoor.idx), p, ctx)));
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
