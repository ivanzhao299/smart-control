import { Body, Controller, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { AudioAdapter } from '../../adapters/audio/audio.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { AudioBgmDto, AudioMicDto, AudioMuteDto, AudioVolumeDto } from './dto/audio.dto';
import { AdapterResult } from '../../adapters/adapter.types';

// 音量滑条会拖出连续命令, 6 次/秒/客户端给点余量
@Controller('audio')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 6, windowMs: 1000 })
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

  /**
   * 调试: 发任意 9 字节十六进制 frame 到 EKX, 返回原始响应 hex.
   * 用于排查协议字段偏移 / 实际固件 vs 说明书的差异.
   * Body: { hex: "7B 7D 01 48 01 00 00 7D 7B" }
   * 返回: { sent: "...", received: "...", receivedBytes: 9 }
   */
  @Post('debug/raw')
  async debugRaw(@Body() body: { hex?: string } = {}) {
    const data = await this.audio.debugSendRaw(body.hex ?? '');
    return { message: '完成', data };
  }

  /**
   * 调试: 用 UDP 发 hex frame 到指定端口. EKX 实际可能不是 TCP 而是 UDP,
   * 9760 TCP 已确认是 echo 不是 EKX 协议, 试 UDP 看会不会有真实响应.
   * Body: { hex: "7B 7D 01 4A 00 00 00 7D 7B", port?: number, host?: string, timeoutMs?: number }
   */
  @Post('debug/udp')
  async debugUdp(@Body() body: { hex?: string; port?: number; host?: string; timeoutMs?: number } = {}) {
    const data = await this.audio.debugSendUdp(
      body.hex ?? '',
      body.host ?? '192.168.50.61',
      body.port ?? 9760,
      body.timeoutMs ?? 2000,
    );
    return { message: '完成', data };
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
