import { BadRequestException, Body, Controller, Get, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { PlaybackOperatorGuard } from '../playback/playback-operator.guard';
import { OnlineMusicService } from './online-music.service';

/**
 * /api/online-music — 在线无版权曲库 (FreePD CC0)。
 * 下载入库与上传媒体同级（素材来源，operator 保留项）：写走 PlaybackOperatorGuard，
 * 需 admin 或 operator 个人账号（assertCanUpload，排除共享令牌）；catalog GET 登录可读。
 */
@Controller('online-music')
@UseGuards(PlaybackOperatorGuard)
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
