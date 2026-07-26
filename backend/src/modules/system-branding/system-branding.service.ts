import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { promises as fs } from 'fs';
import { resolve } from 'path';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Repository } from 'typeorm';
import { Logger } from 'winston';
import { SystemBranding } from '../../entities/system-branding.entity';

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
};

@Injectable()
export class SystemBrandingService implements OnModuleInit {
  constructor(
    @InjectRepository(SystemBranding) private readonly repo: Repository<SystemBranding>,
    @Inject(WINSTON_MODULE_PROVIDER) private readonly logger: Logger,
  ) {}

  /** 启动时确保 id=1 这条记录存在 (没有就插默认), 后续都直接 update id=1 */
  async onModuleInit(): Promise<void> {
    const existing = await this.repo.findOne({ where: { id: 1 } });
    if (!existing) {
      const seed = this.repo.create({ id: 1, ...DEFAULTS });
      await this.repo.save(seed);
      this.logger.info('[SystemBranding] 初始化默认配置 (id=1)');
    }
    await this.healTransparentLogo();
  }

  /**
   * 一次性割接 (2026-07-26): logo 换成透明底版本。
   *
   * 业主投诉 (带投影待机页照片): "外面圆角里面方角图片非常丑, 必须解决" ——
   * 库里存的 logo 是白底图, 待机页/图标把它放进圆角容器里就是白方块怼蓝底。
   * 仓库 frontend/public/brand-logo.png 是同一枚 logo 的**全透明底**版 (本次
   * 已重新裁切居中), 启动时把它以 data URI 写进 logoUrl。
   *
   * 一次性哨兵 = logs/branding-logo-transparent.done 标记文件 (不入 git):
   * 割接过一次就永不再动 —— 业主以后在后台上传新 logo 不会被这里冲掉。
   */
  private async healTransparentLogo(): Promise<void> {
    try {
      const flag = resolve(process.cwd(), '..', 'logs', 'branding-logo-transparent.done');
      if (await fs.access(flag).then(() => true).catch(() => false)) return;
      const asset = resolve(process.cwd(), '..', 'frontend', 'public', 'brand-logo.png');
      const buf = await fs.readFile(asset).catch(() => null);
      if (!buf) return; // 老部署没这文件, 跳过
      const dataUri = `data:image/png;base64,${buf.toString('base64')}`;
      const row = await this.repo.findOne({ where: { id: 1 } });
      if (row && row.logoUrl !== dataUri) {
        row.logoUrl = dataUri;
        await this.repo.save(row);
        this.logger.warn('[SystemBranding] logo 已替换为透明底版本 (2026-07-26 割接)', {
          context: 'SystemBranding',
        });
      }
      await fs.mkdir(resolve(process.cwd(), '..', 'logs'), { recursive: true }).catch(() => {});
      await fs.writeFile(flag, new Date().toISOString()).catch(() => {});
    } catch (e) {
      this.logger.warn(`[SystemBranding] 透明 logo 割接失败: ${(e as Error).message}`, {
        context: 'SystemBranding',
      });
    }
  }

  async get(): Promise<SystemBrandingDto> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    if (!row) {
      // onModuleInit 出错可能没塞, 兜底返默认值 (不写库)
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
    };
  }

  /** 直接读 welcomeMediaId (给 LedController.welcome 用, 不需要拼整个 DTO) */
  async getWelcomeMediaId(): Promise<number | null> {
    const row = await this.repo.findOne({ where: { id: 1 } });
    return row?.welcomeMediaId ?? null;
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

    if (current) {
      await this.repo.update({ id: 1 }, patch);
    } else {
      // onModuleInit 出错的兜底路径
      await this.repo.save(this.repo.create({ id: 1, ...DEFAULTS, ...patch }));
    }
    this.logger.info(`[SystemBranding] 已更新 (${Object.keys(patch).join(', ')})`);
    return this.get();
  }
}
