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
