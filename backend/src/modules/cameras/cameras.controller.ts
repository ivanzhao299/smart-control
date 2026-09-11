import { Controller, Get, Param, Post, Res, BadRequestException, NotFoundException } from '@nestjs/common';
import type { Response } from 'express';
import { CamerasService } from './cameras.service';
import { Public } from '../../common/decorators/public.decorator';

/**
 * /api/cameras
 *
 * 摄像头服务接口
 * - GET /api/cameras/:channel/snapshot: 获取指定通道的快照
 * - GET /api/cameras/channels: 获取支持的通道列表
 * - POST /api/cameras/:channel/hls/start: 启动HLS转码
 * - POST /api/cameras/:channel/hls/stop: 停止HLS转码
 * - GET /api/cameras/:channel/hls/playlist.m3u8: 获取HLS播放列表
 * - GET /api/cameras/:channel/hls/:filename: 获取HLS分片文件
 * - GET /api/cameras/:channel/hls/status: 获取HLS转码状态
 * - GET /api/cameras/hls/sessions: 获取所有HLS会话
 */
@Controller('cameras')
export class CamerasController {
  constructor(private readonly service: CamerasService) {}

  /**
   * 获取指定通道的快照
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

  /**
   * 启动HLS转码
   */
  @Public()
  @Post(':channel/hls/start')
  async startHls(@Param('channel') channel: string) {
    try {
      const result = await this.service.startHlsStream(channel);
      return { message: 'HLS转码已启动', data: result };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * 停止HLS转码
   */
  @Public()
  @Post(':channel/hls/stop')
  async stopHls(@Param('channel') channel: string) {
    try {
      this.service.stopHlsStream(channel);
      return { message: 'HLS转码已停止' };
    } catch (error) {
      throw new BadRequestException((error as Error).message);
    }
  }

  /**
   * 获取HLS播放列表
   */
  @Public()
  @Get(':channel/hls/playlist.m3u8')
  async getPlaylist(@Param('channel') channel: string, @Res() res: Response): Promise<void> {
    const result = this.service.getHlsFile(channel, 'playlist.m3u8');
    if (!result) {
      throw new NotFoundException('HLS播放列表不存在，请先启动转码');
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.send(result.buffer);
  }

  /**
   * 获取HLS分片文件
   */
  @Public()
  @Get(':channel/hls/:filename')
  async getSegment(
    @Param('channel') channel: string,
    @Param('filename') filename: string,
    @Res() res: Response,
  ): Promise<void> {
    // 只允许.ts文件
    if (!filename.endsWith('.ts')) {
      throw new BadRequestException('只允许访问.ts分片文件');
    }

    const result = this.service.getHlsFile(channel, filename);
    if (!result) {
      throw new NotFoundException('HLS分片文件不存在');
    }
    res.setHeader('Content-Type', result.contentType);
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(result.buffer);
  }

  /**
   * 获取HLS转码状态
   */
  @Public()
  @Get(':channel/hls/status')
  async getHlsStatus(@Param('channel') channel: string) {
    const status = this.service.getHlsStatus(channel);
    if (!status) {
      return { message: '查询成功', data: { isRunning: false, channel } };
    }
    return { message: '查询成功', data: { channel, ...status } };
  }

  /**
   * 获取所有HLS会话
   */
  @Public()
  @Get('hls/sessions')
  async getAllHlsSessions() {
    return { message: '查询成功', data: this.service.getAllHlsSessions() };
  }
}
