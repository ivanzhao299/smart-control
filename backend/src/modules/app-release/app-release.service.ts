import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { AppRelease } from '../../entities/app-release.entity';

export interface AppReleaseView {
  platform: string;
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  notes: string | null;
  forceUpdate: boolean;
  minSupportedVersionCode: number;
  enabled: boolean;
  updatedAt: Date;
}

export interface AppReleaseUpsertDto {
  versionCode: number;
  versionName: string;
  downloadUrl: string;
  notes?: string | null;
  forceUpdate?: boolean;
  minSupportedVersionCode?: number;
  enabled?: boolean;
}

/**
 * 启动 seed: Android 当前最新版本 (2026-05-31 = 1.0.1).
 * 后续业主在后台改, 不会被覆盖 (onModuleInit 只在表里没行时才写).
 */
const SEED_ANDROID: AppReleaseUpsertDto = {
  versionCode: 2,
  versionName: '1.0.1',
  downloadUrl: 'https://github.com/ivanzhao299/smart-control/releases/download/v1.0.1-android/app-debug.apk',
  notes: '应用名改为"展厅中控"\n覆盖升级保留服务器地址配置',
  forceUpdate: false,
  minSupportedVersionCode: 1,
  enabled: true,
};

@Injectable()
export class AppReleaseService implements OnModuleInit {
  constructor(
    @InjectRepository(AppRelease) private readonly repo: Repository<AppRelease>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { platform: 'android' } });
    if (existing) return;
    await this.repo.save(this.repo.create({
      platform: 'android',
      ...SEED_ANDROID,
      notes: SEED_ANDROID.notes ?? null,
      forceUpdate: SEED_ANDROID.forceUpdate ?? false,
      minSupportedVersionCode: SEED_ANDROID.minSupportedVersionCode ?? 1,
      enabled: SEED_ANDROID.enabled ?? true,
    }));
    this.logger.info('[AppRelease] seed: android v1.0.1', { context: 'AppReleaseService' });
  }

  /** APP 启动调这个 — 公开, 不要 token */
  async getLatest(platform: string): Promise<AppReleaseView | null> {
    const row = await this.repo.findOne({ where: { platform } });
    if (!row) return null;
    return this.toView(row);
  }

  /** 后台编辑 — admin only */
  async upsert(platform: string, dto: AppReleaseUpsertDto): Promise<AppReleaseView> {
    let row = await this.repo.findOne({ where: { platform } });
    if (!row) {
      row = this.repo.create({ platform });
    }
    Object.assign(row, {
      versionCode: dto.versionCode,
      versionName: dto.versionName,
      downloadUrl: dto.downloadUrl,
      notes: dto.notes ?? null,
      forceUpdate: dto.forceUpdate ?? false,
      minSupportedVersionCode: dto.minSupportedVersionCode ?? 1,
      enabled: dto.enabled ?? true,
    });
    const saved = await this.repo.save(row);
    return this.toView(saved);
  }

  async listAll(): Promise<AppReleaseView[]> {
    const rows = await this.repo.find({ order: { platform: 'ASC' } });
    return rows.map((r) => this.toView(r));
  }

  async detail(platform: string): Promise<AppReleaseView> {
    const view = await this.getLatest(platform);
    if (!view) throw new NotFoundException(`platform "${platform}" 没有发布信息`);
    return view;
  }

  private toView(row: AppRelease): AppReleaseView {
    return {
      platform: row.platform,
      versionCode: row.versionCode,
      versionName: row.versionName,
      downloadUrl: row.downloadUrl,
      notes: row.notes,
      forceUpdate: row.forceUpdate,
      minSupportedVersionCode: row.minSupportedVersionCode,
      enabled: row.enabled,
      updatedAt: row.updatedAt,
    };
  }
}
