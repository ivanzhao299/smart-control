import { Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { resolve } from 'path';
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
    if (!existing) {
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
    await this.healFromBundledManifest();
  }

  /**
   * 全自动发布链 (2026-07-27): CI 构建 APK 后把 manifest.json + APK 提交进
   * deploy/assets/app/, 随部署链落到本机。这里每次启动比对: 仓库里带的版本
   * 比库里记录**新**才更新记录 (downloadUrl 指向本机下载端点, 终端内网直下,
   * 不再依赖 GitHub)。业主在后台手动改的更新版本记录不会被旧包覆盖 —— 只升不降。
   */
  private async healFromBundledManifest(): Promise<void> {
    try {
      const mfPath = resolve(process.cwd(), '..', 'deploy', 'assets', 'app', 'manifest.json');
      const raw = await fs.readFile(mfPath, 'utf8').catch(() => null);
      if (!raw) return; // 还没发布过, 正常
      const mf = JSON.parse(raw) as { platform?: string; versionCode?: number; versionName?: string };
      if (mf.platform !== 'android' || !mf.versionCode || !mf.versionName) return;
      const apkExists = await fs.access(resolve(mfPath, '..', 'smart-control-latest.apk'))
        .then(() => true).catch(() => false);
      if (!apkExists) return; // manifest 在但包不在 (半截提交?), 不动记录
      const row = await this.repo.findOne({ where: { platform: 'android' } });
      if (row && row.versionCode >= mf.versionCode) return; // 只升不降
      await this.upsert('android', {
        versionCode: mf.versionCode,
        versionName: mf.versionName,
        // 展厅局域网固定地址 — 与 App 默认服务器同源 (192.168.77.54)
        downloadUrl: 'http://192.168.77.54:3200/api/app/android/download',
        notes: `v${mf.versionName}: 桌面图标换全透明底新版; 更新改为展厅本地服务器直接下载。\n`
          + '注意: 本次为签名切换版, 需先卸载旧版再安装 (之后的版本可直接覆盖升级)。',
        forceUpdate: row?.forceUpdate ?? false,
        minSupportedVersionCode: row?.minSupportedVersionCode ?? 1,
        enabled: true,
      });
      this.logger.warn(`[AppRelease] 检测到新构建 v${mf.versionName} (code ${mf.versionCode}), 已更新 android 发布记录 → 本地下载`, {
        context: 'AppReleaseService',
      });
    } catch (e) {
      this.logger.warn(`[AppRelease] 发布自愈失败: ${(e as Error).message}`, { context: 'AppReleaseService' });
    }
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
