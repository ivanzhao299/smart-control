import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  AudioConfigService,
  type AudioSceneUpsertDto,
  type AudioZoneUpsertDto,
} from './audio-config.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

/**
 * 音响配置 — 输出通道 + 一键场景的自定义名称.
 *
 * 读: GET (不要 token) — AudioPage 拉这个渲染通道卡 + 场景按钮
 * 写: POST/PUT/DELETE (admin token) — 后台 AudioConfigAdmin 编辑
 */
@Controller('audio-config')
export class AudioConfigController {
  constructor(private readonly service: AudioConfigService) {}

  // ---- 输出通道 ----
  @Get('zones')
  async listZones(@Query('includeDisabled') inc?: string) {
    return { message: 'ok', data: await this.service.listZones(inc === '1' || inc === 'true') };
  }

  @Post('zones')
  @UseGuards(AdminGuard)
  async createZone(@Body() dto: AudioZoneUpsertDto) {
    return { message: '创建成功', data: await this.service.upsertZone(null, dto) };
  }

  @Put('zones/:id')
  @UseGuards(AdminGuard)
  async updateZone(@Param('id', ParseIntPipe) id: number, @Body() dto: AudioZoneUpsertDto) {
    return { message: '更新成功', data: await this.service.upsertZone(id, dto) };
  }

  @Delete('zones/:id')
  @UseGuards(AdminGuard)
  async deleteZone(@Param('id', ParseIntPipe) id: number) {
    return { message: '已删除', data: await this.service.deleteZone(id) };
  }

  // ---- 场景 ----
  @Get('scenes')
  async listScenes(@Query('includeDisabled') inc?: string) {
    return { message: 'ok', data: await this.service.listScenes(inc === '1' || inc === 'true') };
  }

  @Post('scenes')
  @UseGuards(AdminGuard)
  async createScene(@Body() dto: AudioSceneUpsertDto) {
    return { message: '创建成功', data: await this.service.upsertScene(null, dto) };
  }

  @Put('scenes/:id')
  @UseGuards(AdminGuard)
  async updateScene(@Param('id', ParseIntPipe) id: number, @Body() dto: AudioSceneUpsertDto) {
    return { message: '更新成功', data: await this.service.upsertScene(id, dto) };
  }

  @Delete('scenes/:id')
  @UseGuards(AdminGuard)
  async deleteScene(@Param('id', ParseIntPipe) id: number) {
    return { message: '已删除', data: await this.service.deleteScene(id) };
  }
}
