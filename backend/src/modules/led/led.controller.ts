import { Body, Controller, Param, Post, UseGuards } from '@nestjs/common';
import { LedAdapter } from '../../adapters/led/led.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { LedInputDto, LedPlayDto } from './dto/led.dto';
import { AdapterResult } from '../../adapters/adapter.types';
import { SystemBrandingService } from '../system-branding/system-branding.service';
import { PlaybackService } from '../playback/playback.service';

// LED 命令偏重 (开屏 / 切输入 / 推送视频), 限速 4 次/秒/客户端
@Controller('led')
@UseGuards(RateLimitGuard)
@RateLimit({ max: 4, windowMs: 1000 })
export class LedController {
  constructor(
    private readonly led: LedAdapter,
    private readonly logService: OperationLogService,
    private readonly branding: SystemBrandingService,
    private readonly playback: PlaybackService,
  ) {}

  @Post(':id/on')
  on(@Param('id') id: string) {
    return this.wrap(id, 'on', () => this.led.powerOn(id));
  }

  @Post(':id/off')
  off(@Param('id') id: string) {
    return this.wrap(id, 'off', () => this.led.powerOff(id));
  }

  @Post(':id/play')
  play(@Param('id') id: string, @Body() dto: LedPlayDto) {
    return this.wrap(id, 'play', () => this.led.playMedia(id, { media: dto.media }), { media: dto.media });
  }

  /**
   * 欢迎页 — 双路径策略 (2026-06-01):
   *   1. 优先看 SystemBranding.welcomeMediaId — 业主在媒体库设了哪个文件做欢迎页?
   *      有就走 playback 推到 slot=1 (HDMI1 → LED) loop 播.
   *      PlayerPage 收到 WS 切到这个媒体, LED 自然显示 (kiosk 浏览器渲染).
   *   2. 没设就回落到旧逻辑 (V2460 内置 preset 1), 兼容老安装.
   *
   * 业主在 PWA MediaPage 点"设为欢迎页"会写 welcomeMediaId, 之后欢迎页就是
   * 这个文件; 想换内容直接换文件设置即可, 不用碰 NovaLCT.
   */
  @Post(':id/welcome')
  async welcome(@Param('id') id: string) {
    const welcomeMediaId = await this.branding.getWelcomeMediaId();
    if (welcomeMediaId) {
      // 走 playback: 通过 kiosk 浏览器播媒体库里的文件
      try {
        await this.playback.publishMedia(1, welcomeMediaId, { loopMode: 'loop' });
        await this.logService.record({
          operator: 'system',
          action: 'led.welcome',
          targetType: 'led',
          targetId: id,
          result: 'success',
          message: JSON.stringify({ id, cmd: 'welcome', via: 'playback', mediaId: welcomeMediaId }),
        });
        return { message: '已切到欢迎页 (媒体库)', data: { ok: true, mediaId: welcomeMediaId } };
      } catch (e) {
        // playback 失败 (e.g. media 被删) 也回落 V2460 preset, 保证欢迎页能出现
        await this.logService.record({
          operator: 'system',
          action: 'led.welcome',
          targetType: 'led',
          targetId: id,
          result: 'failure',
          message: JSON.stringify({ id, cmd: 'welcome', via: 'playback', mediaId: welcomeMediaId, error: (e as Error).message }),
        });
      }
    }
    // 回落: V2460 preset
    return this.wrap(id, 'welcome', () => this.led.showWelcome(id));
  }

  @Post(':id/input')
  input(@Param('id') id: string, @Body() dto: LedInputDto) {
    return this.wrap(id, 'input', () => this.led.switchInput(id, { input: dto.input }), { input: dto.input });
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
      action: `led.${cmd}`,
      targetType: 'led',
      targetId: id,
      result: result.ok ? 'success' : 'failure',
      message: JSON.stringify({ id, cmd, ...extra, ok: result.ok, error: result.error, durationMs: result.durationMs, mock: result.mock }),
    });
    return { message: result.ok ? '执行成功' : '执行失败', data: result };
  }
}
