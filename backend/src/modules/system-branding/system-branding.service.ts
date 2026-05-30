import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
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
}

const DEFAULTS: SystemBrandingDto = {
  systemName: '金湖展贸中心 · 智能控制',
  systemSubtitle: '智慧展厅中控',
  logoText: '金',
  logoUrl: null,
  browserTitle: '金湖展贸中心 控制系统',
  copyright: null,
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
    };
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
