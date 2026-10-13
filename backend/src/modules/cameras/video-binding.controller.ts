import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { VideoBindingService } from './video-binding.service';
import { AiConfigPusher } from './ai-config.pusher';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import {
  AiBoxDto,
  ChannelAiConfigDto,
  CreateCameraChannelDto,
  CreateNvrDto,
  ExpectedRevisionDto,
  UpdateCameraChannelDto,
  UpdateDisplayLayoutDto,
  UpdateNvrDto,
} from './dto/video-binding.dto';

@Controller('video-binding')
@UseGuards(ModuleAccessGuard)
@ModuleAccess('video')
export class VideoBindingController {
  constructor(
    private readonly videoBindingService: VideoBindingService,
    private readonly aiPusher: AiConfigPusher,
  ) {}

  private writeContext(req: Request, expectedRevision?: number) {
    // 类级 ModuleAccessGuard('video') 已保证写者为 admin/hardware；这里只取 actor 记录审计。
    const actor = requireActor(req as AuthenticatedRequest);
    return {
      expectedRevision,
      actor:
        actor.userId === null
          ? `${actor.kind}:${actor.username}`
          : `${actor.kind}:${actor.userId}:${actor.username}`,
    };
  }

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
  async createNvr(@Req() req: Request, @Body() body: CreateNvrDto) {
    const { expectedRevision, ...data } = body;
    const nvr = await this.videoBindingService.createNvr(
      data,
      this.writeContext(req, expectedRevision),
    );
    return {
      success: true,
      message: 'NVR设备已创建',
      data: nvr,
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  @Put('nvrs/:id')
  async updateNvr(@Req() req: Request, @Param('id') id: string, @Body() body: UpdateNvrDto) {
    const { expectedRevision, ...data } = body;
    const nvr = await this.videoBindingService.updateNvr(
      id,
      data,
      this.writeContext(req, expectedRevision),
    );
    return {
      success: true,
      message: 'NVR设备已更新',
      data: nvr,
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  @Delete('nvrs/:id')
  async deleteNvr(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: ExpectedRevisionDto,
  ) {
    await this.videoBindingService.deleteNvr(id, this.writeContext(req, query.expectedRevision));
    return {
      success: true,
      message: 'NVR设备已删除',
      revision: this.videoBindingService.getConfigView().revision,
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
  async createChannel(@Req() req: Request, @Body() body: CreateCameraChannelDto) {
    const { expectedRevision, ...data } = body;
    const channel = await this.videoBindingService.createChannel(
      data,
      this.writeContext(req, expectedRevision),
    );
    return {
      success: true,
      message: '摄像头通道已创建',
      data: channel,
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  @Put('channels/:id')
  async updateChannel(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: UpdateCameraChannelDto,
  ) {
    const { expectedRevision, ...data } = body;
    const channel = await this.videoBindingService.updateChannel(
      id,
      data,
      this.writeContext(req, expectedRevision),
    );
    return {
      success: true,
      message: '摄像头通道已更新',
      data: channel,
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  @Delete('channels/:id')
  async deleteChannel(
    @Req() req: Request,
    @Param('id') id: string,
    @Query() query: ExpectedRevisionDto,
  ) {
    await this.videoBindingService.deleteChannel(
      id,
      this.writeContext(req, query.expectedRevision),
    );
    return {
      success: true,
      message: '摄像头通道已删除',
      revision: this.videoBindingService.getConfigView().revision,
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
  async updateDisplayLayout(@Req() req: Request, @Body() body: UpdateDisplayLayoutDto) {
    const { expectedRevision, ...data } = body;
    const layout = await this.videoBindingService.updateDisplayLayout(
      data,
      this.writeContext(req, expectedRevision),
    );
    return {
      success: true,
      message: '显示布局已更新',
      data: layout,
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  // ========== AI 检测范围 / 全局框开关（写操作，走登录鉴权） ==========
  // 全局：运营大屏/投影/手机是否叠加 AI 检测框与计数线，一处设置全终端统一
  @Put('ai/box')
  async setAiBox(@Req() req: Request, @Body() body: AiBoxDto) {
    const enabled = await this.videoBindingService.setAiBoxEnabled(
      !!body?.enabled,
      this.writeContext(req, body.expectedRevision),
    );
    return {
      success: true,
      message: 'AI 分析框全局开关已更新',
      data: { aiBoxEnabled: enabled },
      revision: this.videoBindingService.getConfigView().revision,
    };
  }

  // 单路：保存计数线 / ROI 区域 / 是否分析，并热下发给 AI（无需重启 AI）
  @Put('channels/:id/ai')
  async saveChannelAi(
    @Req() req: Request,
    @Param('id') id: string,
    @Body() body: ChannelAiConfigDto,
  ) {
    const { expectedRevision, ...patch } = body || {};
    const channel = await this.videoBindingService.updateChannelAi(
      id,
      patch,
      this.writeContext(req, expectedRevision),
    );
    const push = await this.aiPusher.pushAll();
    return {
      success: true,
      message: push.ok ? '检测范围已保存并热下发到 AI' : `检测范围已保存；${push.message}`,
      data: channel,
      revision: this.videoBindingService.getConfigView().revision,
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
