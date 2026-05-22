import { Body, Controller, Get, Param, ParseIntPipe, Post } from '@nestjs/common';
import { AudioAdapter } from '../../adapters/audio/audio.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { AudioBgmDto, AudioMicDto, AudioMuteDto, AudioVolumeDto } from './dto/audio.dto';
import { AdapterResult } from '../../adapters/adapter.types';

@Controller('audio')
export class AudioController {
  constructor(
    private readonly audio: AudioAdapter,
    private readonly logService: OperationLogService,
  ) {}

  // ============ EKX-808 场景预设 ============

  /** 一键场景切换 (调用 DSP 用户预设 U01-U12) */
  @Post('scene/recall/:preset')
  recallScene(@Param('preset', ParseIntPipe) preset: number) {
    return this.wrap('audio-dsp', `scene.recall.U${preset}`,
      () => this.audio.recallScene(preset),
      { preset });
  }

  /** 读取当前激活的场景号 */
  @Get('scene/current')
  async currentScene() {
    const result = await this.audio.readCurrentScene();
    return { message: result.ok ? 'ok' : 'failed', data: result };
  }

  @Post(':id/volume')
  volume(@Param('id') id: string, @Body() dto: AudioVolumeDto) {
    return this.wrap(id, 'volume',
      () => this.audio.setVolume(id, { value: dto.value, zone: dto.zone }),
      { value: dto.value, zone: dto.zone });
  }

  @Post(':id/mute')
  mute(@Param('id') id: string, @Body() dto: AudioMuteDto) {
    const muted = dto.muted !== false;
    return this.wrap(id, muted ? 'mute' : 'unmute',
      () => (muted ? this.audio.mute(id, { zone: dto.zone }) : this.audio.unmute(id, { zone: dto.zone })),
      { zone: dto.zone, muted });
  }

  @Post(':id/play-bgm')
  playBgm(@Param('id') id: string, @Body() dto: AudioBgmDto) {
    return this.wrap(id, 'play-bgm',
      () => this.audio.playBgm(id, { track: dto.track, zone: dto.zone }),
      { track: dto.track, zone: dto.zone });
  }

  @Post(':id/stop-bgm')
  stopBgm(@Param('id') id: string, @Body() dto: AudioBgmDto) {
    return this.wrap(id, 'stop-bgm',
      () => this.audio.stopBgm(id, { zone: dto.zone }),
      { zone: dto.zone });
  }

  @Post(':id/mic')
  mic(@Param('id') id: string, @Body() dto: AudioMicDto) {
    return this.wrap(id, 'mic',
      () => this.audio.enableMic(id, { enable: dto.enable, zone: dto.zone }),
      { enable: dto.enable, zone: dto.zone });
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
      action: `audio.${cmd}`,
      targetType: 'audio',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ id, cmd, ...extra, ok: result.ok, error: result.error, durationMs: result.durationMs, mock: result.mock }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
