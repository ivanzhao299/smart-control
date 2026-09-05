import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigurationWriteGuard } from './configuration-write.guard';
import { ActorAdminGuard } from './actor-admin.guard';
import { DevicesController } from '../../modules/devices/devices.controller';
import { BrandsController } from '../../modules/brands/brands.controller';
import { DriversController } from '../../modules/drivers/drivers.controller';
import { HardwareController } from '../../modules/hardware/hardware.controller';
import { SceneActionsController } from '../../modules/scenes/scene-actions.controller';
import { ScenesController } from '../../modules/scenes/scenes.controller';
import { SchedulerController } from '../../modules/scheduler/scheduler.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { LogsController } from '../../modules/logs/logs.controller';
import { TestCenterController } from '../../modules/test-center/test-center.controller';
import { UatController } from '../../modules/uat/uat.controller';

describe('configuration versus shared equipment usage', () => {
  const guard = new ConfigurationWriteGuard();
  const ctx = (role: string | null, method: string) => ({ switchToHttp: () => ({ getRequest: () => ({ method, actor: role ? { kind: 'user', userId: 1, username: 'test', role } : undefined }) }) } as any);
  it.each(['viewer', 'operator', 'admin'])('permits %s to read shared configuration', role => {
    expect(guard.canActivate(ctx(role, 'GET'))).toBe(true);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('limits %s configuration to administrators', method => {
    for (const role of ['viewer', 'operator', null]) expect(() => guard.canActivate(ctx(role, method))).toThrow();
    expect(guard.canActivate(ctx('admin', method))).toBe(true);
  });
  it('requires an identity even for reads', () => {
    expect(() => guard.canActivate(ctx(null, 'GET'))).toThrow();
  });
  it.each([DevicesController, BrandsController, DriversController, HardwareController, SceneActionsController])('binds configuration guard to %p', controller => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(ConfigurationWriteGuard);
  });
  it('protects scene editing/testing without blocking normal execute/stop/cancel', () => {
    for (const method of ['create', 'update', 'remove', 'testExecute']) {
      expect(Reflect.getMetadata(GUARDS_METADATA, (ScenesController.prototype as any)[method])).toContain(ActorAdminGuard);
    }
    for (const method of ['execute', 'stop', 'cancel']) {
      expect(Reflect.getMetadata(GUARDS_METADATA, (ScenesController.prototype as any)[method]) ?? []).not.toContain(ActorAdminGuard);
    }
  });
  it.each([SchedulerController, AuditController, LogsController, TestCenterController, UatController])('requires administrator for all %p routes, including reads', controller => {
    expect(Reflect.getMetadata(GUARDS_METADATA, controller)).toContain(ActorAdminGuard);
    const adminGuard = new ActorAdminGuard();
    for (const role of [null, 'viewer', 'operator']) expect(() => adminGuard.canActivate(ctx(role, 'GET'))).toThrow();
    expect(adminGuard.canActivate(ctx('admin', 'GET'))).toBe(true);
  });
  it('attributes audit rollback to the verified named administrator', async () => {
    const rollback = jest.fn(async () => ({ id: 2 }));
    const controller = new AuditController({ rollback } as any);
    await controller.rollback(7, { actor: { kind: 'user', userId: 3, username: 'named-admin', role: 'admin' } } as any);
    expect(rollback).toHaveBeenCalledWith(7, 'named-admin');
    await expect(controller.rollback(7, { actor: { role: 'operator' } } as any)).rejects.toThrow();
    expect(rollback).toHaveBeenCalledTimes(1);
  });
});
