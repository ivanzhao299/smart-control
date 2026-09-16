import { Controller, Get, Post, Put, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { VideoBindingService } from './video-binding.service';
import { AiConfigPusher } from './ai-config.pusher';
import { ConfigurationWriteGuard } from '../../common/guards/configuration-write.guard';
import {
  AiBoxDto,
  ChannelAiConfigDto,
  CreateCameraChannelDto,
  CreateNvrDto,
  UpdateCameraChannelDto,
  UpdateDisplayLayoutDto,
  UpdateNvrDto,
} from './dto/video-binding.dto';

@Controller('video-binding')
@UseGuards(ConfigurationWriteGuard)
export class VideoBindingController {
  constructor(
    private readonly videoBindingService: VideoBindingService,
    private readonly aiPusher: AiConfigPusher,
  ) {}

  // 获取完整配置
  @Get()
  getConfig() {
    return {
      success: true,
      data: this.videoBindingService.getConfigView(),
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
  async createNvr(@Body() data: CreateNvrDto) {
    const nvr = await this.videoBindingService.createNvr(data);
    return {
      success: true,
      message: 'NVR设备已创建',
      data: nvr,
    };
  }

  @Put('nvrs/:id')
  async updateNvr(@Param('id') id: string, @Body() data: UpdateNvrDto) {
    const nvr = await this.videoBindingService.updateNvr(id, data);
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
  async deleteNvr(@Param('id') id: string) {
    const result = await this.videoBindingService.deleteNvr(id);
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
  async createChannel(@Body() data: CreateCameraChannelDto) {
    const channel = await this.videoBindingService.createChannel(data);
    return {
      success: true,
      message: '摄像头通道已创建',
      data: channel,
    };
  }

  @Put('channels/:id')
  async updateChannel(@Param('id') id: string, @Body() data: UpdateCameraChannelDto) {
    const channel = await this.videoBindingService.updateChannel(id, data);
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
  async deleteChannel(@Param('id') id: string) {
    const result = await this.videoBindingService.deleteChannel(id);
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
  async updateDisplayLayout(@Body() data: UpdateDisplayLayoutDto) {
    const layout = await this.videoBindingService.updateDisplayLayout(data);
    return {
      success: true,
      message: '显示布局已更新',
      data: layout,
    };
  }

  // ========== AI 检测范围 / 全局框开关（写操作，走登录鉴权） ==========
  // 全局：运营大屏/投影/手机是否叠加 AI 检测框与计数线，一处设置全终端统一
  @Put('ai/box')
  async setAiBox(@Body() body: AiBoxDto) {
    const enabled = await this.videoBindingService.setAiBoxEnabled(!!body?.enabled);
    return { success: true, message: 'AI 分析框全局开关已更新', data: { aiBoxEnabled: enabled } };
  }

  // 单路：保存计数线 / ROI 区域 / 是否分析，并热下发给 AI（无需重启 AI）
  @Put('channels/:id/ai')
  async saveChannelAi(@Param('id') id: string, @Body() body: ChannelAiConfigDto) {
    const channel = await this.videoBindingService.updateChannelAi(id, body || {});
    if (!channel) return { success: false, message: '摄像头通道不存在' };
    const push = await this.aiPusher.pushAll();
    return {
      success: true,
      message: push.ok ? '检测范围已保存并热下发到 AI' : `检测范围已保存；${push.message}`,
      data: channel,
      push,
    };
  }

  // 手动把当前全部 AI 配置重新下发一次（AI 服务重启 / 曾不可达后补推）
  @Post('ai/push')
  async pushAiConfig() {
    const push = await this.aiPusher.pushAll();
    return { success: push.ok, ...push };
  }
}
