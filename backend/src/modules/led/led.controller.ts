import { Body, Controller, Get, Param, Post, UseGuards, Req, HttpException } from '@nestjs/common';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';
import { LedAdapter } from '../../adapters/led/led.adapter';
import { OperationLogService } from '../logs/operation-log.service';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { WriteRoleGuard } from '../../common/guards/write-role.guard';
import { WriteRoles } from '../../common/decorators/write-roles.decorator';
import { LedInputDto, LedPlayDto } from './dto/led.dto';
import { AdapterResult } from '../../adapters/adapter.types';
import { SystemBrandingService } from '../system-branding/system-branding.service';
import { PlaybackService } from '../playback/playback.service';

// LED 命令偏重 (开屏 / 关屏 / 切输入 / 推送视频 / 欢迎页), 限速 4 次/秒/客户端
// 2026-10-16 第三轮修正：整个控制器都是「大屏播控」(开/关屏、切信号源、播内容、欢迎页)，
// 展厅操作员 operator 的本职就是大屏播控，类级统一放开 admin/operator（与 projector 对齐）。
// 设备配置（绑定/分区/驱动等）不经过本控制器，归后台 devices/hardware 分域，仅 admin。
// welcome 方法体内另有 assertCanUpload 资源级校验（operator 可上传/改名）。
@Controller('led')
@UseGuards(RateLimitGuard, WriteRoleGuard)
@WriteRoles('admin', 'operator')
@RateLimit({ max: 4, windowMs: 1000 })
export class LedController {
  constructor(
    private readonly led: LedAdapter,
    private readonly logService: OperationLogService,
    private readonly branding: SystemBrandingService,
    private readonly playback: PlaybackService,
  ) {}

  /**
   * 就绪探活 (应用层) — 开机预热时前端轮询: 调诺瓦 ReadDeviceID (healthCheck 内部吞错,
   * 设备未就绪返回 ready:false, 不抛 500)。单次 TCP 命令, 不做全量探测。
   */
  @Get('ready')
  async ready() {
    const result = await this.led.healthCheck();
    return { message: '查询成功', data: { ready: result.ok } };
  }

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
   * 欢迎页 (场景引擎/旧客户端入口) — 指向逻辑 2026-07-28 梳理为三级明确链:
   *   1. 业主在媒体页"设为欢迎页"指定的素材 (SystemBranding.welcomeMediaId) —— 设了就播它;
   *   2. 没设过 → 内置「金湖欢迎页·动态(称谓可编辑)」(领导称谓后台可编辑, 20s 生效),
   *      与 LED/投影页"输入源 → 欢迎页·可编辑称谓"按钮同一指向;
   *   3. 推流失败 (kiosk 断/素材被删) → V2460 内置 preset 硬件级兜底, 保证有画面。
   */
  @Post(':id/welcome')
  async welcome(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const actor = requireActor(req);
    assertCanUpload(actor);
    const welcomeMediaId = await this.branding.getWelcomeMediaId();
    try {
      let playedMediaId: number;
      if (welcomeMediaId) {
        await this.playback.publishMedia(1, welcomeMediaId, actor, { loopMode: 'loop' });
        playedMediaId = welcomeMediaId;
      } else {
        const r = await this.playback.publishWelcome(1, 'editable', actor);
        playedMediaId = r.view.currentMediaId ?? -1;
      }
      await this.logService.record({
        operator: actor.username,
        action: 'led.welcome',
        targetType: 'led',
        targetId: id,
        result: 'success',
        message: JSON.stringify({ id, cmd: 'welcome', via: 'playback', mediaId: playedMediaId, custom: !!welcomeMediaId }),
      });
      return { message: '已切到欢迎页 (媒体库)', data: { ok: true, mediaId: playedMediaId } };
    } catch (e) {
      if (e instanceof HttpException && [401, 403, 404].includes(e.getStatus())) throw e;
      // playback 失败 (e.g. media 被删) 回落 V2460 preset, 保证欢迎页能出现
      await this.logService.record({
        operator: actor.username,
        action: 'led.welcome',
        targetType: 'led',
        targetId: id,
        result: 'failure',
        message: JSON.stringify({ id, cmd: 'welcome', via: 'playback', mediaId: welcomeMediaId, error: (e as Error).message }),
      });
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
