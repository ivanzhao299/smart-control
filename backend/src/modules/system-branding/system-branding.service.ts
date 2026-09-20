import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { SystemBranding } from '../../entities/system-branding.entity';
import { lanOrigin } from '../../common/utils/lan-origin';
import {
  normalizeParkOpsConfig,
  PARK_OPS_VISUAL_CONFIG_KEY,
  PARK_OPS_VISUAL_SCHEMA_VERSION,
  type ParkOpsConfigDocument,
} from './park-ops-config';
import { MediaService } from '../media/media.service';

const LED_WELCOME_RESOLUTION = '3612x1462';

export interface SystemBrandingDto {
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
    private readonly media: MediaService,
  ) {}

  async get(): Promise<SystemBrandingDto> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      // 迁移门禁异常时仍给公开页面安全默认值，不在读取路径写库。
      return { ...DEFAULTS };
    }
    return {
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
      // 底图直链: /api/media/:id/file 是 @Public 路由, kiosk 欢迎页无鉴权可读
      welcomeBgUrl: row.welcomeBgMediaId ? `/api/media/${row.welcomeBgMediaId}/file` : null,
      welcomePhotoMediaId: row.welcomePhotoMediaId ?? null,
      // 上墙照片走"仅当前绑定照片"的匿名公开路由 (普通 /api/media/:id/file 需登录,
      // 大屏与扫码手机都没有 token); 加 updatedAt 版本参数让轮询拿到新图而非旧缓存
      welcomePhotoUrl: row.welcomePhotoMediaId
        ? `/api/system-branding/welcome-photo/file?v=${row.updatedAt?.getTime?.() ?? Date.now()}`
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
  ): Promise<{
    config: ParkOpsConfigDocument;
    revision: number;
    checksum: string;
    updatedAt: string;
  }> {
    const config = normalizeParkOpsConfig(input);
    const operation = this.parkOpsMutationQueue.then(() =>
      this.saveParkOpsConfig(config, expectedRevision),
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
            actor: 'admin-api',
            source: 'PUT /api/system-branding/park-ops',
          })
        : await this.runtimeConfig.initialize({
            key: PARK_OPS_VISUAL_CONFIG_KEY,
            schemaVersion: PARK_OPS_VISUAL_SCHEMA_VERSION,
            value: config,
            normalize: normalizeParkOpsConfig,
            actor: 'admin-api',
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

  async update(input: Partial<SystemBrandingDto>): Promise<SystemBrandingDto> {
    // 规整: 空字符串视为 null (避免数据库里塞 ""), trim 前后空格
    const norm = <T extends string | null | undefined>(v: T): string | null => {
      if (v === undefined || v === null) return null;
      const t = String(v).trim();
      return t === '' ? null : t;
    };

    const current = await this.repo.findOne({ where: { id: 1 } });
    const patch: Partial<SystemBranding> = {};

    if (input.systemName !== undefined) {
      const v = norm(input.systemName);
      if (!v) throw new Error('systemName 不能为空');
      if (v.length > 80) throw new Error('systemName 不能超过 80 字符');
      patch.systemName = v;
    }
    if (input.systemSubtitle !== undefined) {
      const v = norm(input.systemSubtitle);
      if (v && v.length > 60) throw new Error('systemSubtitle 不能超过 60 字符');
      patch.systemSubtitle = v;
    }
    if (input.logoText !== undefined) {
      const v = norm(input.logoText);
      if (!v) throw new Error('logoText 不能为空');
      if (v.length > 4) throw new Error('logoText 不能超过 4 字符 (建议 1-2 个汉字)');
      patch.logoText = v;
    }
    if (input.logoUrl !== undefined) {
      patch.logoUrl = norm(input.logoUrl);
    }
    if (input.browserTitle !== undefined) {
      patch.browserTitle = norm(input.browserTitle);
    }
    if (input.copyright !== undefined) {
      patch.copyright = norm(input.copyright);
    }
    if (input.welcomeMediaId !== undefined) {
      // null / undefined / 非整数都视为清空
      const v = input.welcomeMediaId;
      patch.welcomeMediaId = typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
    }
    if (input.welcomeGuest !== undefined) {
      const v = norm(input.welcomeGuest);
      patch.welcomeGuest = v ? v.slice(0, 64) : null;
    }
    if (input.welcomeTitle !== undefined) {
      const v = norm(input.welcomeTitle);
      patch.welcomeTitle = v ? v.slice(0, 32) : null;
    }
    if (input.welcomeTagline !== undefined) {
      const v = norm(input.welcomeTagline);
      patch.welcomeTagline = v ? v.slice(0, 64) : null;
    }
    if (input.welcomeBgMediaId !== undefined) {
      const v = input.welcomeBgMediaId;
      if (typeof v === 'number' && Number.isInteger(v) && v > 0) {
        const background = await this.media.get(v);
        if (background.kind !== 'image' || background.resolution?.toLowerCase() !== LED_WELCOME_RESOLUTION) {
          throw new Error(`欢迎页底图必须是 ${LED_WELCOME_RESOLUTION} 图片`);
        }
        patch.welcomeBgMediaId = v;
      } else {
        patch.welcomeBgMediaId = null;
      }
    }
    if (input.welcomePhotoMediaId !== undefined) {
      // null/非正整数都视为撤下, 回到默认欢迎语布局
      const v = input.welcomePhotoMediaId;
      patch.welcomePhotoMediaId = typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null;
    }

    if (current) {
      await this.repo.update({ id: 1 }, patch);
    } else {
      throw new ConflictException(
        '系统品牌权威记录缺失，请先恢复数据库；保存操作未执行',
      );
    }
    this.logger.info(`[SystemBranding] 已更新 (${Object.keys(patch).join(', ')})`);
    return this.get();
  }
}
