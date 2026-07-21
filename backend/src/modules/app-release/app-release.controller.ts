import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AppReleaseService, type AppReleaseUpsertDto } from './app-release.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

const VALID_PLATFORMS = new Set(['android', 'ios']);

@Controller('app')
export class AppReleaseController {
  constructor(private readonly service: AppReleaseService) {}

  /**
   * APP 启动时调这个 — 公开, 不要任何 token. 返回 latest 版本信息.
   * APP 比对 BuildConfig.VERSION_CODE 跟 versionCode, 不一致弹更新提示.
   *
   * GET /api/app/android/latest
   */
  @Public()
  @Get(':platform/latest')
  async latest(@Param('platform') platform: string) {
    if (!VALID_PLATFORMS.has(platform)) {
      throw new BadRequestException(`platform 必须是 android 或 ios, 实际: ${platform}`);
    }
    const data = await this.service.getLatest(platform);
    return { message: '查询成功', data };
  }

  /** 后台列出所有平台 (admin 编辑用) */
  @Get('list')
  @UseGuards(AdminGuard)
  async list() {
    return { message: '查询成功', data: await this.service.listAll() };
  }

  @Get(':platform')
  @UseGuards(AdminGuard)
  async detail(@Param('platform') platform: string) {
    return { message: '查询成功', data: await this.service.detail(platform) };
  }

  @Put(':platform')
  @UseGuards(AdminGuard)
  async upsert(@Param('platform') platform: string, @Body() dto: AppReleaseUpsertDto) {
    if (!VALID_PLATFORMS.has(platform)) {
      throw new BadRequestException(`platform 必须是 android 或 ios, 实际: ${platform}`);
    }
    if (!dto.versionCode || !dto.versionName || !dto.downloadUrl) {
      throw new BadRequestException('versionCode / versionName / downloadUrl 必填');
    }
    return { message: '已更新', data: await this.service.upsert(platform, dto) };
  }
}
