import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseGuards, Req } from '@nestjs/common';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { BaiduPanService } from './baidu-pan.service';

/**
 * /api/baidu-pan — 百度网盘接入 (配置/设备码授权/浏览/代下载)。
 * 客户端 token 即可 (走全局 ClientAuthGuard) — 与媒体上传同级的日常操作;
 * AppKey/SecretKey 只进 DB 不回显明文 (status 只报 configured 布尔)。
 */
@UseGuards(ActorAdminGuard)
@Controller('baidu-pan')
export class BaiduPanController {
  constructor(private readonly service: BaiduPanService) {}

  @Get('status')
  async status() {
    return { message: '查询成功', data: await this.service.status() };
  }

  @Post('config')
  @HttpCode(200)
  async config(@Body() body: { appKey?: string; secretKey?: string } = {}) {
    if (!body?.appKey?.trim() || !body?.secretKey?.trim()) {
      throw new BadRequestException('appKey / secretKey 必填');
    }
    await this.service.saveConfig(body.appKey, body.secretKey);
    return { message: '已保存, 现在可以开始授权', data: null };
  }

  @Post('auth/start')
  @HttpCode(200)
  async authStart() {
    return { message: '请用手机完成授权', data: await this.service.authStart() };
  }

  @Post('auth/poll')
  @HttpCode(200)
  async authPoll() {
    return { message: '查询成功', data: await this.service.authPoll() };
  }

  @Post('root')
  @HttpCode(200)
  async setRoot(@Body() body: { path?: string | null } = {}) {
    await this.service.setRoot(body?.path ?? null);
    return { message: '可见根目录已更新', data: null };
  }

  @Get('list')
  async list(@Query('dir') dir?: string) {
    return { message: '查询成功', data: await this.service.list(dir ?? '/') };
  }

  @Post('download')
  @HttpCode(200)
  async download(@Req() req: AuthenticatedRequest, @Body() body: { fsId?: number; name?: string } = {}) {
    if (typeof body?.fsId !== 'number' || !body?.name) throw new BadRequestException('fsId / name 必填');
    const r = await this.service.startDownload(body.fsId, body.name, requireActor(req));
    return { message: `「${body.name}」开始下载, 完成后自动入媒体库`, data: r };
  }
}
