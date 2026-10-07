import { ConfigService } from '@nestjs/config';
import { NotFoundException } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { SystemBranding } from '../../entities/system-branding.entity';
import { MediaService } from '../media/media.service';
import { SystemBrandingService } from './system-branding.service';
import {
  DEFAULT_WELCOME_PRESENTATION,
  normalizeWelcomeSchemes,
  WELCOME_SCHEMES_CONFIG_KEY,
  type WelcomeSchemesDocument,
} from './welcome-schemes';

const current = {
  id: 1,
  systemName: '金湖展贸中心 · 智能控制',
  systemSubtitle: null,
  logoText: '金',
  logoUrl: null,
  browserTitle: null,
  copyright: null,
  welcomeMediaId: null,
  welcomeGuest: '原接待嘉宾',
  welcomeTitle: '原欢迎标题',
  welcomeTagline: '原欢迎标语',
  welcomeBgMediaId: null,
  welcomeLogoMediaId: null,
  welcomePresentationJson: null,
  welcomePhotoMediaId: null,
  updatedAt: new Date(0),
} as SystemBranding;

const schemes: WelcomeSchemesDocument = {
  version: 2,
  schemes: [
    {
      id: 'company-a',
      name: '企业甲',
      welcomeTitle: '热烈欢迎',
      welcomeGuest: '企业甲代表团',
      welcomeTagline: '欢迎莅临参观指导',
      welcomeVenue: null,
      welcomeVenueEn: null,
      welcomeOrg1: null,
      welcomeOrg2: null,
      welcomeBgMediaId: 7,
      welcomeLogoMediaId: null,
      presentation: { ...DEFAULT_WELCOME_PRESENTATION },
    },
  ],
};

describe('welcome scheme document', () => {
  it('normalizes text and rejects duplicate identifiers', () => {
    expect(
      normalizeWelcomeSchemes({
        version: 1,
        schemes: [{ ...schemes.schemes[0], name: ' 企业甲 ' }],
      }).schemes[0].name,
    ).toBe('企业甲');
    expect(() =>
      normalizeWelcomeSchemes({
        version: 1,
        schemes: [schemes.schemes[0], schemes.schemes[0]],
      }),
    ).toThrow('ID 重复');
  });

  it('upgrades legacy schemes and preserves a saved presentation for old PWA clients', () => {
    const legacy = {
      version: 1,
      schemes: [{
        ...schemes.schemes[0],
        presentation: undefined,
      }],
    };
    const fallback = {
      ...schemes,
      schemes: [{
        ...schemes.schemes[0],
        presentation: { ...DEFAULT_WELCOME_PRESENTATION, layout: 'editorial' as const },
      }],
    };
    expect(normalizeWelcomeSchemes(legacy, fallback)).toMatchObject({
      version: 2,
      schemes: [{ presentation: { layout: 'editorial' } }],
    });
  });

  it('rejects unbounded presentation values before they reach the LED renderer', () => {
    expect(() => normalizeWelcomeSchemes({
      ...schemes,
      schemes: [{
        ...schemes.schemes[0],
        presentation: { ...DEFAULT_WELCOME_PRESENTATION, layout: 'free-drag' },
      }],
    })).toThrow('欢迎页版式不受支持');
  });

  it('normalizes the title effect enum and defaults legacy presentations to blue', () => {
    const gold = normalizeWelcomeSchemes({
      version: 2,
      schemes: [{ ...schemes.schemes[0], presentation: { ...DEFAULT_WELCOME_PRESENTATION, titleEffect: 'gold' } }],
    });
    expect(gold.schemes[0].presentation.titleEffect).toBe('gold');
    expect(() => normalizeWelcomeSchemes({
      version: 2,
      schemes: [{ ...schemes.schemes[0], presentation: { ...DEFAULT_WELCOME_PRESENTATION, titleEffect: 'rainbow' } }],
    })).toThrow('主标题文字效果不受支持');
    const legacy = normalizeWelcomeSchemes({
      version: 2,
      schemes: [{
        ...schemes.schemes[0],
        presentation: { layout: 'ceremony', tone: 'light', overlay: 'soft', contentPosition: 'center', logoSize: 'medium' },
      }],
    });
    expect(legacy.schemes[0].presentation.titleEffect).toBe('blue');
  });

  it('supports three-state venue/org text: null default, empty string hidden, custom trimmed', () => {
    const doc = normalizeWelcomeSchemes({
      version: 2,
      schemes: [{
        ...schemes.schemes[0],
        welcomeVenue: '  自定义场馆  ',
        welcomeVenueEn: '',
        welcomeOrg1: null,
        welcomeOrg2: '   ',
      }],
    }).schemes[0];
    expect(doc.welcomeVenue).toBe('自定义场馆');
    expect(doc.welcomeVenueEn).toBe('');
    expect(doc.welcomeOrg1).toBeNull();
    expect(doc.welcomeOrg2).toBe('');
  });

  it('rejects over-long or non-string venue/org text', () => {
    expect(() => normalizeWelcomeSchemes({
      version: 2,
      schemes: [{ ...schemes.schemes[0], welcomeVenue: 'x'.repeat(41) }],
    })).toThrow('场馆名称不能超过 40 个字符');
    expect(() => normalizeWelcomeSchemes({
      version: 2,
      schemes: [{ ...schemes.schemes[0], welcomeVenueEn: 123 }],
    })).toThrow('场馆英文名 必须是文本或 null');
  });

  it('fills missing venue/org fields on legacy schemes with null', () => {
    const legacyScheme = { ...schemes.schemes[0] };
    delete (legacyScheme as { welcomeVenue?: string | null }).welcomeVenue;
    delete (legacyScheme as { welcomeVenueEn?: string | null }).welcomeVenueEn;
    delete (legacyScheme as { welcomeOrg1?: string | null }).welcomeOrg1;
    delete (legacyScheme as { welcomeOrg2?: string | null }).welcomeOrg2;
    const out = normalizeWelcomeSchemes({ version: 2, schemes: [legacyScheme] }).schemes[0];
    expect([out.welcomeVenue, out.welcomeVenueEn, out.welcomeOrg1, out.welcomeOrg2])
      .toEqual([null, null, null, null]);
  });
});

describe('SystemBrandingService welcome schemes', () => {
  let dataSource: DataSource;
  let service: SystemBrandingService;
  let repository: Repository<SystemBranding>;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: true,
    });
    await dataSource.initialize();
    repository = {
      findOne: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<SystemBranding>;
    service = new SystemBrandingService(
      repository,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      new RuntimeConfigStore(dataSource),
      {
        ensureImageResolution: jest.fn().mockResolvedValue({
          id: 7,
          kind: 'image',
          resolution: '3612x1462',
        }),
        markShared: jest.fn().mockResolvedValue(undefined),
      } as unknown as MediaService,
    );
  });

  afterEach(async () => dataSource.destroy());

  it('offers defaults without writing and preserves the current published welcome page', async () => {
    const snapshot = await service.getWelcomeSchemes();
    expect(snapshot.revision).toBe(0);
    expect(snapshot.publishedSchemeId).toBe('current');
    expect(snapshot.config.schemes[0]).toMatchObject({
      welcomeTitle: '原欢迎标题',
      welcomeGuest: '原接待嘉宾',
      welcomeTagline: '原欢迎标语',
    });
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
  });

  it('stores revisions and rejects stale editors', async () => {
    const saved = await service.updateWelcomeSchemes(schemes, 0);
    expect(saved.revision).toBe(1);
    await expect(service.updateWelcomeSchemes(schemes, 0)).rejects.toMatchObject({ status: 409 });
    expect(
      await dataSource.getRepository(RuntimeConfigRevision).findOneBy({
        key: WELCOME_SCHEMES_CONFIG_KEY,
        revision: 1,
      }),
    ).toMatchObject({ source: 'PUT /api/system-branding/welcome-schemes' });
  });

  it('publishes one saved scheme through the existing welcome snapshot', async () => {
    await service.updateWelcomeSchemes(schemes, 0);
    await expect(service.publishWelcomeScheme('company-a', 1)).resolves.toMatchObject({
      scheme: { id: 'company-a' },
    });
    expect(repository.update).toHaveBeenCalledWith(
      { id: 1 },
      {
        welcomeTitle: '热烈欢迎',
        welcomeGuest: '企业甲代表团',
        welcomeTagline: '欢迎莅临参观指导',
        welcomeVenue: null,
        welcomeVenueEn: null,
        welcomeOrg1: null,
        welcomeOrg2: null,
        welcomeBgMediaId: 7,
        welcomeLogoMediaId: null,
        welcomePresentationJson: JSON.stringify(DEFAULT_WELCOME_PRESENTATION),
      },
    );
  });

  it('removes a welcome image only after clearing every draft and published reference', async () => {
    const currentRow = {
      ...current,
      welcomeBgMediaId: 7,
      welcomeLogoMediaId: 8,
    } as SystemBranding;
    const repositoryWithState = {
      findOne: jest.fn(async () => currentRow),
      update: jest.fn(async (_where, patch: Partial<SystemBranding>) => {
        Object.assign(currentRow, patch);
        return { affected: 1 };
      }),
    } as unknown as Repository<SystemBranding>;
    const media = {
      ensureImageResolution: jest.fn(async (id: number) => ({
        id,
        kind: 'image',
        resolution: id === 7 ? '3612x1462' : '1200x400',
      })),
      remove: jest.fn().mockResolvedValue({ removedId: 7, cleanupPending: false }),
      markShared: jest.fn().mockResolvedValue(undefined),
    } as unknown as MediaService;
    const subject = new SystemBrandingService(
      repositoryWithState,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      new RuntimeConfigStore(dataSource),
      media,
    );
    const document: WelcomeSchemesDocument = {
      version: 2,
      schemes: [
        { ...schemes.schemes[0], welcomeBgMediaId: 7, welcomeLogoMediaId: 8 },
        { ...schemes.schemes[0], id: 'company-b', name: '企业乙', welcomeBgMediaId: 7 },
      ],
    };
    await subject.updateWelcomeSchemes(document, 0);

    const result = await subject.removeWelcomeAsset(7, 1, {
      kind: 'admin', userId: null, username: 'admin', role: 'admin',
    });

    expect(result.removedId).toBe(7);
    expect(result.schemes.revision).toBe(2);
    expect(result.schemes.config.schemes.every((item) => item.welcomeBgMediaId === null)).toBe(true);
    expect(result.schemes.config.schemes.map((item) => item.welcomeLogoMediaId)).toEqual([8, null]);
    expect(repositoryWithState.update).toHaveBeenCalledWith(
      { id: 1 },
      { welcomeBgMediaId: null },
    );
    expect(media.remove).toHaveBeenCalledWith(7, expect.objectContaining({ role: 'admin' }));
  });

  it('treats an already absent welcome image as an idempotent delete', async () => {
    const media = {
      ensureImageResolution: jest.fn().mockResolvedValue({
        id: 7,
        kind: 'image',
        resolution: '3612x1462',
      }),
      remove: jest.fn().mockRejectedValue(new NotFoundException('资料不存在')),
      markShared: jest.fn().mockResolvedValue(undefined),
    } as unknown as MediaService;
    const subject = new SystemBrandingService(
      repository,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      new RuntimeConfigStore(dataSource),
      media,
    );
    await subject.updateWelcomeSchemes(schemes, 0);

    await expect(subject.removeWelcomeAsset(7, 1, {
      kind: 'admin', userId: null, username: 'admin', role: 'admin',
    })).resolves.toMatchObject({
      removedId: 7,
      cleanupPending: false,
      schemes: {
        config: { schemes: [{ welcomeBgMediaId: null }] },
      },
    });
  });
});
