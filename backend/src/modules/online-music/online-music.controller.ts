import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { OnlineMusicService } from './online-music.service';

/**
 * /api/online-music — 在线无版权曲库 (FreePD CC0)。
 * 客户端 token 即可 (走全局 ClientAuthGuard): 下载音乐和上传媒体同级, 属日常操作。
 */
@Controller('online-music')
export class OnlineMusicController {
  constructor(private readonly service: OnlineMusicService) {}

  @Get('catalog')
  async catalog(@Req() req: AuthenticatedRequest) {
    return { message: '查询成功', data: await this.service.catalog(requireActor(req)) };
  }

  @Post('download')
  @HttpCode(200)
  async download(@Req() req: AuthenticatedRequest, @Body() body: { path?: string } = {}) {
    if (!body?.path || typeof body.path !== 'string') throw new BadRequestException('path 必填');
    const r = await this.service.download(body.path, requireActor(req));
    return { message: `「${r.originalName}」已下载入库`, data: r };
  }
}
