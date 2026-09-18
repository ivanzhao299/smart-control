import 'reflect-metadata';
import { GUARDS_METADATA, PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { HvacController } from '../../modules/hvac/hvac.controller';
import { DaliLightsController } from '../../modules/dali-lights/dali-lights.controller';
import { AudioConfigController } from '../../modules/audio-config/audio-config.controller';
import { AdminGuard } from '../../modules/admin-auth/admin-auth.guard';
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
import { VideoBindingController } from '../../modules/cameras/video-binding.controller';
import { LightZonesController } from '../../modules/light-zones/light-zones.controller';

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
  it.each([DevicesController, BrandsController, DriversController, HardwareController, SceneActionsController, VideoBindingController])('binds configuration guard to %p', controller => {
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
  it.each([
    [HvacController, ['indoors/reorder', 'indoors/:idx', 'indoors/assign', 'zones', 'zones/:code', 'gateways/scan']],
    [DaliLightsController, ['scan', 'diagnose', 'diagnose/identify', 'diagnose/control', ':id/identify', ':id/name', ':id/zone', 'assign-zone', 'scenes', 'scenes/:code']],
    [LightZonesController, ['reorder/zones', 'reorder/groups', 'groups', 'groups/assign', 'groups/:groupId/shorts', '', ':id']],
  ] as const)('protects %p configuration while preserving ordinary controls', (controller, protectedPaths) => {
    let checked = 0, ordinary = 0;
    for (const name of Object.getOwnPropertyNames(controller.prototype)) {
      const method = (controller.prototype as any)[name];
      if (typeof method !== 'function') continue;
      const path = Reflect.getMetadata(PATH_METADATA, method);
      const verb = Reflect.getMetadata(METHOD_METADATA, method);
      if (verb === undefined) continue;
      const guards = Reflect.getMetadata(GUARDS_METADATA, method) ?? [];
      const configuration = (protectedPaths as readonly string[]).includes(path) &&
        (verb !== RequestMethod.GET || path === 'diagnose' || path === 'gateways/scan');
      if (configuration) {
        expect(guards.some((g: unknown) => g === ActorAdminGuard || g === ConfigurationWriteGuard || g === AdminGuard)).toBe(true);
        checked++;
      }
      else { expect(guards).not.toContain(ActorAdminGuard); ordinary++; }
    }
    expect(checked).toBeGreaterThanOrEqual(7);
    expect(ordinary).toBeGreaterThan(0);
  });
  it('protects the previously unguarded audio input configuration update', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, AudioConfigController.prototype.updateInput)).toContain(AdminGuard);
  });
});
