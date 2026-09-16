import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Put,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream, promises as fs } from 'fs';
import { resolve } from 'path';
import { AppReleaseService, type AppReleaseUpsertDto } from './app-release.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { Public } from '../../common/decorators/public.decorator';

const VALID_PLATFORMS = new Set(['android', 'ios']);

@Controller('app')
export class AppReleaseController {
  constructor(private readonly service: AppReleaseService) {}

  /**
   * 展厅本地 APK 下载 (2026-07-27 全自动发布链)。
   *
   * CI 构建的 APK 随 git 落在 deploy/assets/app/smart-control-latest.apk,
   * 终端 App 的"立即更新"跳到这里直接从内网下载 —— 不再依赖 GitHub
   * (大陆网络下 GitHub release 资产经常拉不动)。
   *
   * 注意: 本路由必须排在 ':platform/latest' 等参数路由之前 (Nest 按声明序匹配)。
   */
  @Public()
  @Get('android/download')
  async download(@Res() res: Response): Promise<void> {
    const apk = resolve(process.cwd(), '..', 'deploy', 'assets', 'app', 'smart-control-latest.apk');
    const stat = await fs.stat(apk).catch(() => null);
    if (!stat) throw new NotFoundException('APK 尚未发布 (deploy/assets/app 下没有安装包)');
    // 文件名同样只读数据库权威记录；部署清单不是运行时数据源。
    const release = await this.service.getLatest('android');
    const safeVersion = release?.versionName.replace(/[^0-9A-Za-z._-]/g, '');
    const name = safeVersion ? `smart-control-v${safeVersion}.apk` : 'smart-control-latest.apk';
    res.setHeader('Content-Type', 'application/vnd.android.package-archive');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    createReadStream(apk).pipe(res);
  }

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
