import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { RuntimeConfigStore } from '../../common/runtime-config/runtime-config.store';
import { RuntimeConfigDocument } from '../../entities/runtime-config-document.entity';
import { RuntimeConfigRevision } from '../../entities/runtime-config-revision.entity';
import { SystemBranding } from '../../entities/system-branding.entity';
import { PARK_OPS_VISUAL_CONFIG_KEY } from './park-ops-config';
import { SystemBrandingService } from './system-branding.service';

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
    const first = await service.updateParkOpsConfig(fixture('企业甲'), 0, 'user:42:editor');
    const unchanged = await service.updateParkOpsConfig(fixture('企业甲'), 1);
    await expect(service.updateParkOpsConfig(fixture('旧页面覆盖'), 0)).rejects.toMatchObject({
      status: 409,
    });
    const second = await service.updateParkOpsConfig(fixture('企业乙'), 1, 'user:43:second');

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
      { revision: 1, actor: 'user:42:editor', source: 'PUT /api/system-branding/park-ops' },
      { revision: 2, actor: 'user:43:second', source: 'PUT /api/system-branding/park-ops' },
    ]);
  });

  it('only one service instance can win concurrent first-save and later same-version writes', async () => {
    const other = new SystemBrandingService(
      {} as Repository<SystemBranding>,
      { info: jest.fn(), warn: jest.fn() } as never,
      new ConfigService(),
      new RuntimeConfigStore(dataSource),
    );
    for (const expectedRevision of [0, 1]) {
      const results = await Promise.allSettled([
        service.updateParkOpsConfig(fixture('甲' + expectedRevision), expectedRevision),
        other.updateParkOpsConfig(fixture('乙' + expectedRevision), expectedRevision),
      ]);
      expect(results.filter((item) => item.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((item) => item.status === 'rejected')).toMatchObject({
        reason: { status: 409 },
      });
      expect((await service.getParkOpsConfig()).revision).toBe(expectedRevision + 1);
      expect(await dataSource.getRepository(RuntimeConfigRevision).count()).toBe(
        expectedRevision + 1,
      );
    }
  });

  it('rejects invalid revision values even for internal callers without writing', async () => {
    for (const revision of [-1, NaN, 1.2, Number.MAX_SAFE_INTEGER + 1]) {
      await expect(service.updateParkOpsConfig(fixture('无效'), revision)).rejects.toMatchObject({
        status: 400,
      });
    }
    expect(await dataSource.getRepository(RuntimeConfigDocument).count()).toBe(0);
  });
});

describe('SystemBrandingService singleton authority', () => {
  it('refuses an update when the migrated singleton is missing', async () => {
    const db = await new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [SystemBranding],
      synchronize: true,
    }).initialize();
    const repository = db.getRepository(SystemBranding);
    const service = new SystemBrandingService(
      repository,
      { info: jest.fn(), warn: jest.fn(), error: jest.fn() } as never,
      new ConfigService(),
      {} as RuntimeConfigStore,
    );

    try {
      expect((await service.get()).configRevision).toBeNull();
      await expect(
        service.update(
          { systemName: '不会静默重建' },
          {
            kind: 'admin',
            userId: null,
            username: 'fixture-admin',
            role: 'admin',
          },
        ),
      ).rejects.toMatchObject({ status: 409, response: { code: 'SYSTEM_BRANDING_MISSING' } });
      expect(await repository.count()).toBe(0);
    } finally {
      await db.destroy();
    }
  });
});
