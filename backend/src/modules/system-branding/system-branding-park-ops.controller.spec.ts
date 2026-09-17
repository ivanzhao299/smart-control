import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { AuthenticatedRequest } from '../../common/auth/actor';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { UpdateParkOpsLayoutDto } from './park-ops-editor.dto';
import { MediaService } from '../media/media.service';
import { SystemBrandingController } from './system-branding.controller';
import { SystemBrandingService } from './system-branding.service';

describe('SystemBrandingController park ops writes', () => {
  const admin = {
    actor: { kind: 'user', userId: 42, username: 'layout-admin', role: 'admin' },
  } as AuthenticatedRequest;
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

    await expect(
      controller.updateParkOps(admin, { config, expectedRevision: 3 }),
    ).resolves.toMatchObject({
      data: { revision: 4 },
    });
    expect(service.updateParkOpsConfig).toHaveBeenCalledWith(config, 3, 'user:42:layout-admin');
  });

  it('preserves HTTP 409 so a stale editor cannot hide a version conflict', async () => {
    const conflict = new ConflictException({ code: 'RUNTIME_CONFIG_REVISION_CONFLICT' });
    const service = {
      updateParkOpsConfig: jest.fn().mockRejectedValue(conflict),
    } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(controller.updateParkOps(admin, { config, expectedRevision: 2 })).rejects.toBe(
      conflict,
    );
  });

  it('rejects malformed revision metadata before writing', async () => {
    const service = {
      updateParkOpsConfig: jest.fn(),
    } as unknown as SystemBrandingService;
    const controller = new SystemBrandingController(service, {} as MediaService);

    await expect(
      controller.updateParkOps(admin, { config, expectedRevision: -1 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(service.updateParkOpsConfig).not.toHaveBeenCalled();
  });

  it('requires runtime-validated editor metadata and rejects forged identity fields', async () => {
    const pipe = new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    });
    const parse = (value: unknown) =>
      pipe.transform(value, { type: 'body', metatype: UpdateParkOpsLayoutDto });
    await expect(parse({ config, expectedRevision: 0 })).resolves.toMatchObject({
      expectedRevision: 0,
    });
    for (const expectedRevision of [
      undefined,
      null,
      '1',
      true,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      await expect(parse({ config, expectedRevision })).rejects.toBeInstanceOf(BadRequestException);
    }
    await expect(parse({ config: [], expectedRevision: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ config, expectedRevision: 0, actor: 'forged' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('retains both guards, verifies actor, and preserves the explicit legacy raw adapter', async () => {
    const service = { updateParkOpsConfig: jest.fn().mockResolvedValue({ revision: 1 }) };
    const controller = new SystemBrandingController(
      service as unknown as SystemBrandingService,
      {} as MediaService,
    );
    for (const handler of [controller.saveParkOpsEditor, controller.updateParkOps]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(AdminGuard);
    }
    await expect(
      controller.saveParkOpsEditor({} as AuthenticatedRequest, { config, expectedRevision: 0 }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      controller.saveParkOpsEditor(
        { actor: { ...admin.actor!, role: 'operator' } } as AuthenticatedRequest,
        { config, expectedRevision: 0 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updateParkOpsConfig).not.toHaveBeenCalled();
    await controller.updateParkOps(admin, config);
    expect(service.updateParkOpsConfig).toHaveBeenCalledWith(
      config,
      undefined,
      'user:42:layout-admin',
    );
    await controller.saveParkOpsEditor(admin, { config, expectedRevision: 0 });
    expect(service.updateParkOpsConfig).toHaveBeenLastCalledWith(config, 0, 'user:42:layout-admin');
  });
});
