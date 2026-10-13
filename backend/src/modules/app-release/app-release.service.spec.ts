import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AppRelease } from '../../entities/app-release.entity';
import { AppReleaseService } from './app-release.service';

function release(overrides: Partial<AppRelease> = {}): AppRelease {
  return {
    id: 1,
    platform: 'android',
    versionCode: 22,
    versionName: '1.1.14',
    downloadUrl: 'http://192.168.77.54:3200/api/app/android/download',
    notes: '保留说明',
    forceUpdate: false,
    minSupportedVersionCode: 1,
    enabled: true,
    releaseSource: 'bundled',
    artifactCommit: null,
    artifactSha256: null,
    artifactSize: null,
    artifactBuiltAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('AppReleaseService', () => {
  it('lets operators change policy without changing deployment-owned metadata', async () => {
    const row = release();
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn(async (value: AppRelease) => value),
    } as unknown as Repository<AppRelease>;
    const service = new AppReleaseService(repo);

    const result = await service.upsert('android', {
      versionCode: 22,
      versionName: '1.1.14',
      downloadUrl: 'http://192.168.77.54:3200/api/app/android/download',
      notes: '新的运营说明',
      forceUpdate: true,
      minSupportedVersionCode: 10,
      enabled: false,
    });

    expect(result).toMatchObject({
      versionCode: 22,
      versionName: '1.1.14',
      notes: '新的运营说明',
      forceUpdate: true,
      minSupportedVersionCode: 10,
      enabled: false,
      releaseSource: 'bundled',
    });
  });

  it('rejects a metadata edit for a deployment-owned release', async () => {
    const row = release();
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn(),
    } as unknown as Repository<AppRelease>;
    const service = new AppReleaseService(repo);

    await expect(
      service.upsert('android', {
        versionCode: 23,
        versionName: '1.1.15',
        downloadUrl: row.downloadUrl,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repo.save).not.toHaveBeenCalled();
  });

  it('updateOps(config) changes only operational switches and never touches version metadata', async () => {
    const row = release({ releaseSource: 'manual' });
    const repo = {
      findOne: jest.fn().mockResolvedValue(row),
      save: jest.fn(async (value: AppRelease) => value),
    } as unknown as Repository<AppRelease>;
    const service = new AppReleaseService(repo);

    // config 的入参通道里根本没有技术字段, 即便调用方想夹带也无法改版本号/下载地址。
    const result = await service.updateOps('android', {
      notes: '运营更新',
      forceUpdate: true,
      minSupportedVersionCode: 5,
      enabled: false,
    });

    expect(result).toMatchObject({
      versionCode: 22,
      versionName: '1.1.14',
      downloadUrl: 'http://192.168.77.54:3200/api/app/android/download',
      notes: '运营更新',
      forceUpdate: true,
      minSupportedVersionCode: 5,
      enabled: false,
    });
  });

  it('updateOps refuses when there is no release record yet (config cannot first-publish)', async () => {
    const repo = {
      findOne: jest.fn().mockResolvedValue(null),
      save: jest.fn(),
    } as unknown as Repository<AppRelease>;
    const service = new AppReleaseService(repo);

    await expect(service.updateOps('android', { enabled: false })).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.save).not.toHaveBeenCalled();
  });
});
