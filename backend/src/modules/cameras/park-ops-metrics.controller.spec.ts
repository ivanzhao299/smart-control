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
import { ParkOpsMetricsController } from './park-ops-metrics.controller';
import { ParkOpsMetricsService } from './park-ops-metrics.service';
import { UpdateParkOpsMetricsDto } from './dto/park-ops-metrics.dto';

const admin = {
  actor: { kind: 'user', userId: 42, username: 'editor', role: 'admin' },
} as AuthenticatedRequest;
const document = {
  version: 1,
  source: 'test',
  updatedAt: '2026-09-17',
  placeholderKeys: [],
  metrics: {},
  content: {},
};

describe('Park operations editor contract', () => {
  const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
  const parse = (body: unknown) =>
    pipe.transform(body, { type: 'body', metatype: UpdateParkOpsMetricsDto });

  it('accepts revision zero but rejects missing, null, coerced, unsafe or forged metadata', async () => {
    await expect(parse({ document, expectedRevision: 0 })).resolves.toMatchObject({
      document,
      expectedRevision: 0,
    });
    for (const expectedRevision of [
      undefined,
      null,
      '1',
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
      true,
    ]) {
      await expect(parse({ document, expectedRevision })).rejects.toBeInstanceOf(
        BadRequestException,
      );
    }
    await expect(parse({ document, expectedRevision: 0, actor: 'forged' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(parse({ document: [], expectedRevision: 0 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('retains administrator guards and derives audit identity only from verified request actor', async () => {
    const service = {
      updateSnapshot: jest.fn().mockResolvedValue({ revision: 1 }),
      update: jest.fn(),
      getSnapshot: jest.fn(),
    };
    const controller = new ParkOpsMetricsController(service as unknown as ParkOpsMetricsService);
    for (const handler of [controller.editor, controller.saveEditor, controller.update]) {
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(AdminGuard);
    }
    await controller.saveEditor(admin, { document, expectedRevision: 0 });
    expect(service.updateSnapshot).toHaveBeenCalledWith(document, {
      expectedRevision: 0,
      actor: 'user:42:editor',
    });
    await controller.update(admin, document);
    expect(service.update).toHaveBeenCalledWith(document, { actor: 'user:42:editor' });
    await expect(controller.editor({} as AuthenticatedRequest)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      controller.saveEditor(
        { actor: { ...admin.actor!, role: 'operator' } } as AuthenticatedRequest,
        { document, expectedRevision: 1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(service.updateSnapshot).toHaveBeenCalledTimes(1);
  });

  it('keeps revision conflicts as 409 and maps malformed documents to a stable error code', async () => {
    const conflict = new ConflictException({ code: 'PARK_OPS_METRICS_REVISION_CONFLICT' });
    const service = { updateSnapshot: jest.fn().mockRejectedValue(conflict) };
    const controller = new ParkOpsMetricsController(service as unknown as ParkOpsMetricsService);
    await expect(controller.saveEditor(admin, { document, expectedRevision: 0 })).rejects.toBe(
      conflict,
    );
    service.updateSnapshot.mockImplementation(() => {
      throw new Error('invalid metrics');
    });
    await expect(
      controller.saveEditor(admin, { document, expectedRevision: 0 }),
    ).rejects.toMatchObject({ response: { code: 'PARK_OPS_METRICS_INVALID' } });
  });
});
