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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AudioConfigService } from './audio-config.service';
import {
  AudioDeleteQueryDto,
  AudioInputUpsertDto,
  AudioSceneUpsertDto,
  AudioZoneUpsertDto,
} from './dto/audio-config.dto';
import { AuthenticatedRequest, requireAdmin } from '../../common/auth/actor';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

/**
 * 音响配置 — 输出通道 + 一键场景的自定义名称.
 *
 * 读: GET 沿用全局访问策略 — AudioPage 拉这个渲染通道卡 + 场景按钮
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
  async createZone(@Req() req: AuthenticatedRequest, @Body() dto: AudioZoneUpsertDto) {
    return {
      message: '创建成功',
      data: await this.service.upsertZone(null, dto, requireAdmin(req)),
    };
  }

  @Put('zones/:id')
  @UseGuards(AdminGuard)
  async updateZone(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AudioZoneUpsertDto,
  ) {
    return { message: '更新成功', data: await this.service.upsertZone(id, dto, requireAdmin(req)) };
  }

  @Delete('zones/:id')
  @UseGuards(AdminGuard)
  async deleteZone(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AudioDeleteQueryDto,
  ) {
    return {
      message: '已删除',
      data: await this.service.deleteZone(id, query.expectedRevision, requireAdmin(req)),
    };
  }

  // ---- 输入源 ----
  @Get('inputs')
  async listInputs(@Query('includeDisabled') inc?: string) {
    return { message: 'ok', data: await this.service.listInputs(inc === '1' || inc === 'true') };
  }

  @Post('inputs')
  @UseGuards(AdminGuard)
  async createInput(@Req() req: AuthenticatedRequest, @Body() dto: AudioInputUpsertDto) {
    return {
      message: '创建成功',
      data: await this.service.upsertInput(null, dto, requireAdmin(req)),
    };
  }

  @Put('inputs/:id')
  @UseGuards(AdminGuard)
  async updateInput(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AudioInputUpsertDto,
  ) {
    return {
      message: '更新成功',
      data: await this.service.upsertInput(id, dto, requireAdmin(req)),
    };
  }

  @Delete('inputs/:id')
  @UseGuards(AdminGuard)
  async deleteInput(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AudioDeleteQueryDto,
  ) {
    return {
      message: '已删除',
      data: await this.service.deleteInput(id, query.expectedRevision, requireAdmin(req)),
    };
  }

  // ---- 场景 ----
  @Get('scenes')
  async listScenes(@Query('includeDisabled') inc?: string) {
    return { message: 'ok', data: await this.service.listScenes(inc === '1' || inc === 'true') };
  }

  @Post('scenes')
  @UseGuards(AdminGuard)
  async createScene(@Req() req: AuthenticatedRequest, @Body() dto: AudioSceneUpsertDto) {
    return {
      message: '创建成功',
      data: await this.service.upsertScene(null, dto, requireAdmin(req)),
    };
  }

  @Put('scenes/:id')
  @UseGuards(AdminGuard)
  async updateScene(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AudioSceneUpsertDto,
  ) {
    return {
      message: '更新成功',
      data: await this.service.upsertScene(id, dto, requireAdmin(req)),
    };
  }

  @Delete('scenes/:id')
  @UseGuards(AdminGuard)
  async deleteScene(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: AudioDeleteQueryDto,
  ) {
    return {
      message: '已删除',
      data: await this.service.deleteScene(id, query.expectedRevision, requireAdmin(req)),
    };
  }
}
