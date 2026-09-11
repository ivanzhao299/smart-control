import { Controller, Get, Param, Res, BadRequestException } from '@nestjs/common';
import type { Response } from 'express';
import { CamerasService } from './cameras.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * /api/cameras
 *
 * 摄像头快照代理接口
 * - GET /api/cameras/:channel/snapshot: 获取指定通道的快照
 * - GET /api/cameras/channels: 获取支持的通道列表
 */
@Controller('cameras')
export class CamerasController {
  constructor(private readonly service: CamerasService) {}

  /**
   * 获取指定通道的快照
   * 公开接口，运营大屏直接调用
   */
  @Public()
  @Get(':channel/snapshot')
  async getSnapshot(@Param('channel') channel: string, @Res() res: Response): Promise<void> {
    try {
      const { buffer, contentType } = await this.service.getSnapshot(channel);
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.send(buffer);
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * 获取支持的通道列表
   */
  @Public()
  @Get('channels')
  async getChannels() {
    return { message: '查询成功', data: this.service.getSupportedChannels() };
  }
}
