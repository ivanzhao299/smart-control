import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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
  releaseSource: 'bundled' | 'manual';
  artifactCommit: string | null;
  artifactSha256: string | null;
  artifactSize: number | null;
  artifactBuiltAt: Date | null;
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
 * 运营字段（非管理员 config 可改）：启停推送 / 强制更新 / 最低兼容版本 / 更新说明。
 * 明确不含 versionCode/versionName/downloadUrl —— 技术字段由 CI/受控部署维护。
 */
export interface AppReleaseOpsDto {
  notes?: string | null;
  forceUpdate?: boolean;
  minSupportedVersionCode?: number;
  enabled?: boolean;
}

@Injectable()
export class AppReleaseService {
  constructor(@InjectRepository(AppRelease) private readonly repo: Repository<AppRelease>) {}

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
      row = this.repo.create({ platform, releaseSource: 'manual' });
    } else if (row.releaseSource === 'bundled') {
      const metadataChanged =
        row.versionCode !== dto.versionCode ||
        row.versionName !== dto.versionName ||
        row.downloadUrl !== dto.downloadUrl;
      if (metadataChanged) {
        throw new BadRequestException(
          `${platform} 版本号和下载地址由受控部署流程维护，请发布经过校验的安装包`,
        );
      }
    }
    Object.assign(
      row,
      row.releaseSource === 'bundled'
        ? {}
        : {
            versionCode: dto.versionCode,
            versionName: dto.versionName,
            downloadUrl: dto.downloadUrl,
          },
      {
        notes: dto.notes ?? null,
        forceUpdate: dto.forceUpdate ?? false,
        minSupportedVersionCode: dto.minSupportedVersionCode ?? 1,
        enabled: dto.enabled ?? true,
      },
    );
    const saved = await this.repo.save(row);
    return this.toView(saved);
  }

  /**
   * 运营配置员(config)改运营开关 —— 只更新启停/强制更新/最低兼容/更新说明,
   * 绝不触碰版本号/下载地址(技术字段)。无发布记录时拒绝(不能凭空首发, 那是 admin/CI 的事)。
   */
  async updateOps(platform: string, dto: AppReleaseOpsDto): Promise<AppReleaseView> {
    const row = await this.repo.findOne({ where: { platform } });
    if (!row) {
      throw new NotFoundException(`${platform} 尚无发布记录，请先由管理员发布版本`);
    }
    Object.assign(row, {
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
      releaseSource: row.releaseSource,
      artifactCommit: row.artifactCommit,
      artifactSha256: row.artifactSha256,
      artifactSize: row.artifactSize,
      artifactBuiltAt: row.artifactBuiltAt,
      updatedAt: row.updatedAt,
    };
  }
}
