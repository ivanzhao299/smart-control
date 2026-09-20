import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { SystemBranding } from '../../entities/system-branding.entity';
import { PARK_OPS_VISUAL_CONFIG_KEY } from './park-ops-config';
import { SystemBrandingService } from './system-branding.service';
import { MediaService } from '../media/media.service';

const fixture = (company: string) => ({
  version: 1,
  fitMode: 'stretch',
  phases: [
    {
      id: '1',
      name: '一期',
      zoneName: '智造区',
      color: '#63d9ff',
      fontSize: 15,
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
    },
  ],
  buildings: [
    {
      id: 'b1',
      phase: '1',
      number: '01#',
      company,
      x: 10,
      y: 20,
      fontSize: 12,
      color: '#ffffff',
    },
  ],
  textOverrides: {},
  customTexts: [],
});

describe('SystemBrandingService park ops runtime configuration', () => {
  let dataSource: DataSource;
  let service: SystemBrandingService;

  beforeEach(async () => {
    dataSource = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [RuntimeConfigDocument, RuntimeConfigRevision],
      synchronize: true,
    });
    await dataSource.initialize();
    service = new SystemBrandingService(
      {} as Repository<SystemBranding>,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      new RuntimeConfigStore(dataSource),
      {} as MediaService,
    );
  });

  afterEach(async () => {
    await dataSource.destroy();
  });

  it('returns an explicit empty snapshot before the first save', async () => {
    await expect(service.getParkOpsConfig()).resolves.toEqual({
      config: null,
      revision: 0,
      checksum: null,
      updatedAt: null,
    });
  });

  it('keeps one current document and immutable revisions for real changes', async () => {
    const first = await service.updateParkOpsConfig(fixture('企业甲'));
    const unchanged = await service.updateParkOpsConfig(fixture('企业甲'), 1);
    await expect(service.updateParkOpsConfig(fixture('旧页面覆盖'), 0)).rejects.toMatchObject({
      status: 409,
    });
    const second = await service.updateParkOpsConfig(fixture('企业乙'), 1);

    expect(first.revision).toBe(1);
    expect(unchanged.revision).toBe(1);
    expect(second.revision).toBe(2);
    await expect(service.getParkOpsConfig()).resolves.toMatchObject({
      config: fixture('企业乙'),
      revision: 2,
      checksum: second.checksum,
    });
    expect(
      await dataSource.getRepository(RuntimeConfigRevision).find({
        where: { key: PARK_OPS_VISUAL_CONFIG_KEY },
        order: { revision: 'ASC' },
      }),
    ).toMatchObject([
      { revision: 1, actor: 'admin-api', source: 'PUT /api/system-branding/park-ops' },
      { revision: 2, actor: 'admin-api', source: 'PUT /api/system-branding/park-ops' },
    ]);
  });
});

describe('SystemBrandingService singleton authority', () => {
  it('refuses an update when the migrated singleton is missing', async () => {
    const repository = {
      findOne: jest.fn().mockResolvedValue(null),
      update: jest.fn(),
      save: jest.fn(),
      create: jest.fn(),
    } as unknown as Repository<SystemBranding>;
    const service = new SystemBrandingService(
      repository,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      {} as RuntimeConfigStore,
      {} as MediaService,
    );

    await expect(service.update({ systemName: '不会静默重建' })).rejects.toMatchObject({
      status: 409,
    });
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.save).not.toHaveBeenCalled();
  });
});

describe('SystemBrandingService LED welcome background geometry', () => {
  const current = {
    id: 1,
    systemName: '金湖展贸中心 · 智能控制',
    systemSubtitle: null,
    logoText: '金',
    logoUrl: null,
    browserTitle: null,
    copyright: null,
    welcomeMediaId: null,
    welcomeGuest: null,
    welcomeTitle: null,
    welcomeTagline: null,
    welcomeBgMediaId: null,
    welcomePhotoMediaId: null,
    updatedAt: new Date(0),
  } as SystemBranding;

  function subject(resolution: string) {
    const repository = {
      findOne: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    } as unknown as Repository<SystemBranding>;
    const media = {
      get: jest.fn().mockResolvedValue({ id: 7, kind: 'image', resolution }),
    } as unknown as MediaService;
    const service = new SystemBrandingService(
      repository,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      {} as RuntimeConfigStore,
      media,
    );
    return { repository, service };
  }

  it('rejects a background that would be resized or cropped on the LED wall', async () => {
    const { repository, service } = subject('1920x1080');
    await expect(service.update({ welcomeBgMediaId: 7 })).rejects.toThrow('3612x1462');
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('accepts a native 3612x1462 background', async () => {
    const { repository, service } = subject('3612x1462');
    await expect(service.update({ welcomeBgMediaId: 7 })).resolves.toBeDefined();
    expect(repository.update).toHaveBeenCalledWith({ id: 1 }, { welcomeBgMediaId: 7 });
  });
});
