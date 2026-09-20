import { BadRequestException, ConflictException } from '@nestjs/common';
import { MediaService } from '../media/media.service';
import { SystemBrandingController } from './system-branding.controller';
import { SystemBrandingService } from './system-branding.service';

describe('SystemBrandingController park ops writes', () => {
  const config = {
    version: 1,
    fitMode: 'stretch',
    phases: [],
    buildings: [],
  };

  it('passes the editor revision to the service', async () => {
    const service = {
      updateParkOpsConfig: jest.fn().mockResolvedValue({ config, revision: 4 }),
    } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateParkOps({ config, expectedRevision: 3 })).resolves.toMatchObject({
      data: { revision: 4 },
    });
    expect(service.updateParkOpsConfig).toHaveBeenCalledWith(config, 3);
  });

  it('preserves HTTP 409 so a stale editor cannot hide a version conflict', async () => {
    const conflict = new ConflictException({ code: 'RUNTIME_CONFIG_REVISION_CONFLICT' });
    const service = {
      updateParkOpsConfig: jest.fn().mockRejectedValue(conflict),
    } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateParkOps({ config, expectedRevision: 2 })).rejects.toBe(conflict);
  });

  it('rejects malformed revision metadata before writing', async () => {
    const service = {
      updateParkOpsConfig: jest.fn(),
    } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateParkOps({ config, expectedRevision: -1 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(service.updateParkOpsConfig).not.toHaveBeenCalled();
  });
});

describe('SystemBrandingController welcome writes', () => {
  it('returns the database-backed saved value', async () => {
    const saved = { welcomeTitle: '欢迎光临', welcomeGuest: null, welcomeTagline: null, welcomeBgMediaId: null };
    const service = { update: jest.fn().mockResolvedValue(saved) } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateWelcome({ welcomeTitle: '欢迎光临' })).resolves.toMatchObject({ data: saved });
    expect(service.update).toHaveBeenCalledWith({ welcomeTitle: '欢迎光临' });
  });

  it('preserves service conflicts instead of disguising them as validation errors', async () => {
    const conflict = new ConflictException('系统品牌权威记录缺失');
    const service = { update: jest.fn().mockRejectedValue(conflict) } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateWelcome({ welcomeTitle: '欢迎光临' })).rejects.toBe(conflict);
  });
});
