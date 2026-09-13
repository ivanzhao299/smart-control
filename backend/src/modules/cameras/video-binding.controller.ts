import { Controller, Get, Post, Put, Delete, Body, Param, Query } from '@nestjs/common';
import { VideoBindingService, NvrDevice, CameraChannel } from './video-binding.service';

@Controller('video-binding')
export class VideoBindingController {
  constructor(private readonly videoBindingService: VideoBindingService) {}

  // 获取完整配置
  @Get()
  getConfig() {
    return {
      success: true,
      data: this.videoBindingService.getConfig(),
    };
  }

  // 获取运营大屏显示的视频通道
  @Get('display')
  getDisplayChannels() {
    return {
      success: true,
      data: this.videoBindingService.getDisplayChannels(),
    };
  }

  // ========== NVR 设备管理 ==========
  @Get('nvrs')
  getNvrs() {
    return {
      success: true,
      data: this.videoBindingService.getNvrs(),
    };
  }

  @Post('nvrs')
  createNvr(@Body() data: Omit<NvrDevice, 'id' | 'createdAt'>) {
    const nvr = this.videoBindingService.createNvr(data);
    return {
      success: true,
      message: 'NVR设备已创建',
      data: nvr,
    };
  }

  @Put('nvrs/:id')
  updateNvr(@Param('id') id: string, @Body() data: Partial<NvrDevice>) {
    const nvr = this.videoBindingService.updateNvr(id, data);
    if (!nvr) {
      return { success: false, message: 'NVR设备不存在' };
    }
    return {
      success: true,
      message: 'NVR设备已更新',
      data: nvr,
    };
  }

  @Delete('nvrs/:id')
  deleteNvr(@Param('id') id: string) {
    const result = this.videoBindingService.deleteNvr(id);
    if (!result) {
      return { success: false, message: 'NVR设备不存在' };
    }
    return {
      success: true,
      message: 'NVR设备已删除',
    };
  }

  // 测试NVR连接
  @Post('nvrs/:id/test')
  async testNvrConnection(@Param('id') id: string) {
    const result = await this.videoBindingService.testNvrConnection(id);
    return result;
  }

  // ========== 摄像头通道管理 ==========
  @Get('channels')
  getChannels() {
    return {
      success: true,
      data: this.videoBindingService.getChannels(),
    };
  }

  @Post('channels')
  createChannel(@Body() data: Omit<CameraChannel, 'id' | 'createdAt'>) {
    const channel = this.videoBindingService.createChannel(data);
    return {
      success: true,
      message: '摄像头通道已创建',
      data: channel,
    };
  }

  @Put('channels/:id')
  updateChannel(@Param('id') id: string, @Body() data: Partial<CameraChannel>) {
    const channel = this.videoBindingService.updateChannel(id, data);
    if (!channel) {
      return { success: false, message: '摄像头通道不存在' };
    }
    return {
      success: true,
      message: '摄像头通道已更新',
      data: channel,
    };
  }

  @Delete('channels/:id')
  deleteChannel(@Param('id') id: string) {
    const result = this.videoBindingService.deleteChannel(id);
    if (!result) {
      return { success: false, message: '摄像头通道不存在' };
    }
    return {
      success: true,
      message: '摄像头通道已删除',
    };
  }

  // ========== 显示布局管理 ==========
  @Get('layout')
  getDisplayLayout() {
    return {
      success: true,
      data: this.videoBindingService.getConfig().displayLayout,
    };
  }

  @Put('layout')
  updateDisplayLayout(@Body() data: { columns?: number; channelIds?: string[] }) {
    const layout = this.videoBindingService.updateDisplayLayout(data);
    return {
      success: true,
      message: '显示布局已更新',
      data: layout,
    };
  }
}
