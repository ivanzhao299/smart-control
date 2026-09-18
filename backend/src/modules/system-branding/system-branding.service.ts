import { BadRequestException, ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { SystemBranding } from '../../entities/system-branding.entity';
import { lanOrigin } from '../../common/utils/lan-origin';
import type { Actor } from '../../common/auth/actor';
import { writeSystemBranding } from './system-branding-config.writer';
import {
  normalizeParkOpsConfig,
  PARK_OPS_VISUAL_CONFIG_KEY,
  PARK_OPS_VISUAL_SCHEMA_VERSION,
  type ParkOpsConfigDocument,
} from './park-ops-config';

export interface SystemBrandingDto {
  /** null means the public fallback is not a writable configuration baseline. */
  configRevision: number | null;
  systemName: string;
  systemSubtitle: string | null;
  logoText: string;
  logoUrl: string | null;
  browserTitle: string | null;
  copyright: string | null;
  /** 欢迎页绑定的媒体 ID. null = 没设, LED welcome 按钮回落到 V2460 preset */
  welcomeMediaId: number | null;
  /** 欢迎页嘉宾称谓 (可编辑, 空 = 欢迎页显示默认 "各位领导嘉宾") */
  welcomeGuest: string | null;
  /** 欢迎页主标题 (空 = 默认 "热烈欢迎") — 2026-07-28 前端欢迎页编辑器 */
  welcomeTitle: string | null;
  /** 欢迎页底部标语 (空 = 默认 "智慧展厅 · 数字展贸 · 科创未来") */
  welcomeTagline: string | null;
  /** 欢迎页底图媒体 id (空 = 内置"鎏金夜湖"程序化底图) */
  welcomeBgMediaId: number | null;
  /** 只读: 底图直链 (由 welcomeBgMediaId 算出, 欢迎页/编辑器预览直接用) */
  welcomeBgUrl?: string | null;
  /** 欢迎页"来访者拍照上墙"照片媒体 id (空 = 保持默认欢迎语布局) */
  welcomePhotoMediaId: number | null;
  /** 只读: 上墙照片公开直链 (由 welcomePhotoMediaId 算出, 大屏轮询直接用; 走匿名公开路由) */
  welcomePhotoUrl?: string | null;
  /** 只读: 手机可访问的本机局域网 origin (拼照片下载二维码绝对地址; env PUBLIC_ORIGIN 可覆盖) */
  serverOrigin?: string;
}

const DEFAULTS: SystemBrandingDto = {
  configRevision: null,
  systemName: '金湖展贸中心 · 智能控制',
  systemSubtitle: '智慧展厅中控',
  logoText: '金',
  logoUrl: null,
  browserTitle: '金湖展贸中心 控制系统',
  copyright: null,
  welcomeMediaId: null,
  welcomeGuest: null,
  welcomeTitle: null,
  welcomeTagline: null,
  welcomeBgMediaId: null,
  welcomePhotoMediaId: null,
};

@Injectable()
export class SystemBrandingService {
  private parkOpsMutationQueue: Promise<void> = Promise.resolve();

  constructor(
    @InjectRepository(SystemBranding) private readonly repo: Repository<SystemBranding>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
    private readonly config: ConfigService,
    private readonly runtimeConfig: RuntimeConfigStore,
  ) {}

  async get(): Promise<SystemBrandingDto> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      // 迁移门禁异常时仍给公开页面安全默认值，不在读取路径写库。
      return { ...DEFAULTS };
    }
    return this.toView(row);
  }

  private toView(row: SystemBranding): SystemBrandingDto {
    return {
      configRevision: row.configRevision,
      systemName: row.systemName,
      systemSubtitle: row.systemSubtitle,
      logoText: row.logoText,
      logoUrl: row.logoUrl,
      browserTitle: row.browserTitle,
      copyright: row.copyright,
      welcomeMediaId: row.welcomeMediaId,
      welcomeGuest: row.welcomeGuest,
      welcomeTitle: row.welcomeTitle,
      welcomeTagline: row.welcomeTagline,
      welcomeBgMediaId: row.welcomeBgMediaId,
      // Only the currently bound background is public; general media still requires login.
      welcomeBgUrl: row.welcomeBgMediaId
        ? `/api/system-branding/welcome-background/file?v=${row.configRevision}`
        : null,
      welcomePhotoMediaId: row.welcomePhotoMediaId ?? null,
      // 上墙照片走"仅当前绑定照片"的匿名公开路由 (普通 /api/media/:id/file 需登录,
      // 大屏与扫码手机都没有 token); 修订号避免同一秒内改图仍命中旧缓存
      welcomePhotoUrl: row.welcomePhotoMediaId
        ? `/api/system-branding/welcome-photo/file?v=${row.configRevision}`
        : null,
      serverOrigin: lanOrigin(this.config.get<number>('app.port') ?? 3000),
    };
  }

  /** 直接读当前上墙照片媒体 id (给匿名公开文件路由用, 无绑定返回 null) */
  async getWelcomePhotoMediaId(): Promise<number | null> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    const v = row?.welcomePhotoMediaId;
    return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
  }

  async getWelcomeBackgroundMediaId(): Promise<number | null> {
    const row = await this.repo.findOneBy({ id: 1 });
    const id = row?.welcomeBgMediaId;
    return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  /** 直接读 welcomeMediaId (给 LedController.welcome 用, 不需要拼整个 DTO) */
  async getWelcomeMediaId(): Promise<number | null> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    return row?.welcomeMediaId ?? null;
  }

  async getParkOpsConfig(): Promise<{
    config: ParkOpsConfigDocument | null;
    revision: number;
    checksum: string | null;
    updatedAt: string | null;
  }> {
    const snapshot = await this.runtimeConfig.read(
      PARK_OPS_VISUAL_CONFIG_KEY,
      normalizeParkOpsConfig,
    );
    return snapshot
      ? {
          config: snapshot.value,
          revision: snapshot.revision,
          checksum: snapshot.checksum,
          updatedAt: snapshot.updatedAt,
        }
      : { config: null, revision: 0, checksum: null, updatedAt: null };
  }

  async updateParkOpsConfig(
    input: unknown,
    expectedRevision?: number,
    actor = 'system',
  ): Promise<{
    config: ParkOpsConfigDocument;
    revision: number;
    checksum: string;
    updatedAt: string;
  }> {
    if (
      expectedRevision !== undefined &&
      (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0)
    ) {
      throw new BadRequestException('expectedRevision 必须是非负安全整数');
    }
    const config = normalizeParkOpsConfig(input);
    const operation = this.parkOpsMutationQueue.then(() =>
      this.saveParkOpsConfig(config, expectedRevision, actor),
    );
    this.parkOpsMutationQueue = operation.then(
      () => undefined,
      () => undefined,
    );
    return operation;
  }

  private async saveParkOpsConfig(
    config: ParkOpsConfigDocument,
    expectedRevision?: number,
    actor = 'system',
  ): Promise<{
    config: ParkOpsConfigDocument;
    revision: number;
    checksum: string;
    updatedAt: string;
  }> {
    const current = await this.runtimeConfig.read(
      PARK_OPS_VISUAL_CONFIG_KEY,
      normalizeParkOpsConfig,
    );
    const actualRevision = current?.revision ?? 0;
    if (expectedRevision !== undefined && expectedRevision !== actualRevision) {
      throw new ConflictException({
        code: 'RUNTIME_CONFIG_REVISION_CONFLICT',
        key: PARK_OPS_VISUAL_CONFIG_KEY,
        expectedRevision,
        actualRevision,
      });
    }
    try {
      const saved = current
        ? await this.runtimeConfig.update({
            key: PARK_OPS_VISUAL_CONFIG_KEY,
            schemaVersion: PARK_OPS_VISUAL_SCHEMA_VERSION,
            expectedRevision: current.revision,
            value: config,
            normalize: normalizeParkOpsConfig,
            actor,
            source: 'PUT /api/system-branding/park-ops',
          })
        : await this.runtimeConfig.initialize({
            key: PARK_OPS_VISUAL_CONFIG_KEY,
            schemaVersion: PARK_OPS_VISUAL_SCHEMA_VERSION,
            expectedRevision: 0,
            value: config,
            normalize: normalizeParkOpsConfig,
            actor,
            source: 'PUT /api/system-branding/park-ops',
          });
      this.logger.info(`[SystemBranding] 园区大屏布局配置已更新 (revision=${saved.revision})`);
      return {
        config: saved.value,
        revision: saved.revision,
        checksum: saved.checksum,
        updatedAt: saved.updatedAt,
      };
    } catch (error) {
      if (error instanceof ConflictException) {
        this.logger.warn('[SystemBranding] 园区大屏布局保存发生版本冲突，已拒绝旧写入');
      }
      throw error;
    }
  }

  async update(
    input: unknown,
    actor: Actor,
    welcomeOnly = false,
    strict = false,
  ): Promise<SystemBrandingDto> {
    // Return the row acknowledged by this transaction, not a later unrelated writer's revision.
    return this.toView(await writeSystemBranding(this.repo, input, actor, welcomeOnly, strict));
  }
}
