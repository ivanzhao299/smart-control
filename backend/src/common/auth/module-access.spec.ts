import 'reflect-metadata';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  canAccessModule,
  canReadModule,
  canWriteModule,
  type AdminModule,
} from './rbac';
import { MODULE_ACCESS_KEY } from '../decorators/module-access.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { ModuleAccessGuard } from '../guards/module-access.guard';
import { ActorAdminGuard } from '../guards/actor-admin.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { AdminGuard } from '../../modules/admin-auth/admin-auth.guard';
import { DevicesController } from '../../modules/devices/devices.controller';
import { HardwareController } from '../../modules/hardware/hardware.controller';
import { DriversController } from '../../modules/drivers/drivers.controller';
import { BrandsController } from '../../modules/brands/brands.controller';
import { SceneActionsController } from '../../modules/scenes/scene-actions.controller';
import { ScenesController } from '../../modules/scenes/scenes.controller';
import { VideoBindingController } from '../../modules/cameras/video-binding.controller';
import { LogsController } from '../../modules/logs/logs.controller';
import { TestCenterController } from '../../modules/test-center/test-center.controller';
import { UatController } from '../../modules/uat/uat.controller';
import { SchedulerController } from '../../modules/scheduler/scheduler.controller';
import { AudioConfigController } from '../../modules/audio-config/audio-config.controller';
import { EnergyController } from '../../modules/energy/energy.controller';
import { PowerCircuitsController } from '../../modules/power-circuits/power-circuits.controller';
import { PowerSchedulesController } from '../../modules/power-schedules/power-schedules.controller';
import { LightZonesController } from '../../modules/light-zones/light-zones.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { LprController } from '../../modules/lpr/lpr.controller';
import { SystemBrandingController } from '../../modules/system-branding/system-branding.controller';
import { AppReleaseController } from '../../modules/app-release/app-release.controller';

describe('RBAC module matrix', () => {
  it('admin always has full access', () => {
    const modules: AdminModule[] = [
      'monitor', 'alerts', 'scenes', 'scheduler', 'energy', 'devices', 'hardware',
      'zones', 'video', 'lpr', 'diagnostics', 'uat', 'metrics', 'branding', 'app-release', 'system',
    ];
    for (const m of modules) {
      expect(canWriteModule('admin', m)).toBe(true);
      expect(canReadModule('admin', m)).toBe(true);
      expect(canAccessModule('admin', m)).toBe(true);
    }
  });

  it('hardware can write hardware modules but not config modules', () => {
    for (const m of ['devices', 'hardware', 'zones', 'video', 'lpr', 'diagnostics', 'uat'] as AdminModule[]) {
      expect(canWriteModule('hardware', m)).toBe(true);
    }
    for (const m of ['alerts', 'scenes', 'scheduler', 'energy', 'metrics', 'branding'] as AdminModule[]) {
      expect(canWriteModule('hardware', m)).toBe(false);
      expect(canAccessModule('hardware', m)).toBe(false);
    }
    // 系统类对硬件工程师完全隐藏
    expect(canAccessModule('hardware', 'system')).toBe(false);
    // 硬件工程师可读公共排查页
    expect(canReadModule('hardware', 'monitor')).toBe(true);
    expect(canReadModule('hardware', 'diagnostics')).toBe(true);
    // 测试/调试(UAT)硬件工程师可见可写
    expect(canWriteModule('hardware', 'uat')).toBe(true);
    expect(canAccessModule('hardware', 'uat')).toBe(true);
    // APP 版本：硬件工程师只读核对（现场判断手机 App 是否最新），不能改
    expect(canReadModule('hardware', 'app-release')).toBe(true);
    expect(canWriteModule('hardware', 'app-release')).toBe(false);
  });

  it('config can write config modules but not hardware modules', () => {
    for (const m of ['alerts', 'scenes', 'scheduler', 'energy', 'metrics'] as AdminModule[]) {
      expect(canWriteModule('config', m)).toBe(true);
      expect(canAccessModule('config', m)).toBe(true);
    }
    // 品牌管理仅管理员：config 不可见、不可写（欢迎页内容编辑走独立 RolesGuard，不在此模块）
    expect(canWriteModule('config', 'branding')).toBe(false);
    expect(canAccessModule('config', 'branding')).toBe(false);
    // hardware 同样看不到品牌管理
    expect(canWriteModule('hardware', 'branding')).toBe(false);
    expect(canAccessModule('hardware', 'branding')).toBe(false);
    for (const m of ['devices', 'hardware', 'zones', 'video', 'lpr', 'uat'] as AdminModule[]) {
      expect(canWriteModule('config', m)).toBe(false);
      expect(canAccessModule('config', m)).toBe(false);
    }
    // config 可读日志/监控, 但不能写调试
    expect(canReadModule('config', 'diagnostics')).toBe(true);
    expect(canWriteModule('config', 'diagnostics')).toBe(false);
    // 测试/调试(UAT)是硬件动作页, 不给 config 只读, 直接隐藏
    expect(canReadModule('config', 'uat')).toBe(false);
    expect(canAccessModule('config', 'uat')).toBe(false);
    // APP 版本：config 可改运营开关（版本号/下载地址由 controller 层硬隔离给 admin/CI）
    expect(canWriteModule('config', 'app-release')).toBe(true);
    expect(canAccessModule('config', 'app-release')).toBe(true);
    expect(canAccessModule('config', 'system')).toBe(false);
  });

  it('operator/viewer cannot write backend modules and are kept out of restricted reads', () => {
    for (const role of ['operator', 'viewer'] as const) {
      for (const m of ['devices', 'scenes', 'energy', 'zones', 'lpr', 'branding', 'metrics'] as AdminModule[]) {
        expect(canWriteModule(role, m)).toBe(false);
      }
      // 后台专属只读（调度/日志/测试/应用发布）不放前台角色
      expect(canReadModule(role, 'scheduler')).toBe(false);
      expect(canReadModule(role, 'diagnostics')).toBe(false);
      expect(canReadModule(role, 'uat')).toBe(false);
      expect(canReadModule(role, 'app-release')).toBe(false);
    }
    // 前台共用读（readRestricted=false）仍放行登录角色, 避免 PWA 被破坏
    expect(canReadModule('operator', 'devices')).toBe(true);
    expect(canReadModule('viewer', 'energy')).toBe(true);
  });
});

describe('RBAC controller bindings', () => {
  const classGuards = (controller: Function) =>
    (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
  const classModule = (controller: Function) =>
    Reflect.getMetadata(MODULE_ACCESS_KEY, controller) as AdminModule | undefined;

  it.each([
    [DevicesController, 'devices'],
    [HardwareController, 'hardware'],
    [DriversController, 'hardware'],
    [BrandsController, 'hardware'],
    [SceneActionsController, 'scenes'],
    [VideoBindingController, 'video'],
    [LogsController, 'diagnostics'],
    [TestCenterController, 'uat'],
    [UatController, 'uat'],
    [SchedulerController, 'scheduler'],
  ] as const)('binds %p to ModuleAccessGuard(%s)', (controller, module) => {
    expect(classGuards(controller)).toContain(ModuleAccessGuard);
    expect(classModule(controller)).toBe(module);
  });

  // 这几个控制器与前台 PWA 共用读（部分 @Public），写守卫在方法级声明。
  const boundModules = (controller: unknown): Set<AdminModule> => {
    const set = new Set<AdminModule>();
    const proto = (controller as any).prototype;
    for (const name of Object.getOwnPropertyNames(proto)) {
      const handler = proto[name];
      if (typeof handler !== 'function') continue;
      const guards = (Reflect.getMetadata(GUARDS_METADATA, handler) ?? []) as unknown[];
      const mod = Reflect.getMetadata(MODULE_ACCESS_KEY, handler) as AdminModule | AdminModule[] | undefined;
      if (guards.includes(ModuleAccessGuard) && mod) {
        for (const m of Array.isArray(mod) ? mod : [mod]) set.add(m);
      }
    }
    return set;
  };
  it.each([
    [AudioConfigController, 'zones'],
    [EnergyController, 'energy'],
    [PowerCircuitsController, 'zones'],
    [LightZonesController, 'zones'],
    [AppReleaseController, 'app-release'],
  ] as const)('guards write methods of %p with ModuleAccessGuard(%s)', (controller, module) => {
    expect(boundModules(controller).has(module)).toBe(true);
  });

  it('app release admin endpoints drop AdminGuard for module-scoped access while public download/latest stay open', () => {
    const proto = AppReleaseController.prototype as any;
    // 后台管理端点（list/detail/upsert）改用分域守卫，不再仅 admin
    for (const name of ['list', 'detail', 'upsert']) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? []) as unknown[];
      expect(guards).toContain(ModuleAccessGuard);
      expect(guards).not.toContain(AdminGuard);
      expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto[name])).toBe('app-release');
    }
    // 终端下载与版本检测保持公开
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.download)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.latest)).toBe(true);
  });

  it('governs power-schedules writes by BOTH energy (config) and zones (hardware)', () => {
    // 同一套回路自动开关规则：config 从「自动开关」(energy) 配、hardware 从「电源回路」(zones) 配。
    expect(boundModules(PowerSchedulesController)).toEqual(new Set<AdminModule>(['energy', 'zones']));
  });

  it('grants multi-module writes when the role can write ANY listed module (OR)', async () => {
    const mkGuard = (modules: AdminModule | AdminModule[], role: string, method = 'POST') => {
      const reflector = {
        getAllAndOverride: () => modules,
      } as any;
      const moduleRef = { get: () => null } as any;
      const ctx = {
        getHandler: () => ({}),
        getClass: () => ({}),
        switchToHttp: () => ({
          getRequest: () => ({ method, actor: { kind: 'admin', role } }),
        }),
      } as any;
      return new ModuleAccessGuard(reflector, moduleRef).canActivate(ctx);
    };

    // hardware 不能写 energy，但能写 zones → 双模块 OR 放行
    await expect(mkGuard(['energy', 'zones'], 'hardware')).resolves.toBe(true);
    // config 能写 energy → 放行
    await expect(mkGuard(['energy', 'zones'], 'config')).resolves.toBe(true);
    // admin 全通
    await expect(mkGuard(['energy', 'zones'], 'admin')).resolves.toBe(true);
    // operator / viewer 两个模块都不能写 → 拒绝
    await expect(mkGuard(['energy', 'zones'], 'operator')).rejects.toThrow();
    await expect(mkGuard(['energy', 'zones'], 'viewer')).rejects.toThrow();
    // 单模块（字符串）行为保持不变
    await expect(mkGuard('zones', 'hardware')).resolves.toBe(true);
    await expect(mkGuard('energy', 'hardware')).rejects.toThrow();
  });

  it('keeps system-only controllers under admin guard', () => {
    expect(classGuards(AuditController)).toContain(ActorAdminGuard);
  });

  it('guards scene config writes but leaves execute/stop/cancel open to PWA operators', () => {
    for (const name of ['create', 'update', 'remove', 'testExecute']) {
      const handler = (ScenesController.prototype as any)[name];
      expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(ModuleAccessGuard);
      expect(Reflect.getMetadata(MODULE_ACCESS_KEY, handler)).toBe('scenes');
    }
    for (const name of ['execute', 'stop', 'cancel']) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, (ScenesController.prototype as any)[name]) ?? []) as unknown[];
      expect(guards).not.toContain(ModuleAccessGuard);
      expect(guards).not.toContain(ActorAdminGuard);
    }
  });

  it('keeps gate open/close available to duty staff while locking camera config to hardware', () => {
    const proto = LprController.prototype as any;
    // 值班开闸/落杆：限速但不按后台模块锁角色
    for (const name of ['openGate', 'closeGate']) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? []) as unknown[];
      expect(guards).toContain(RateLimitGuard);
      expect(guards).not.toContain(ModuleAccessGuard);
    }
    // 含相机后台口令的管理列表：仅 admin/hardware
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.adminDevices)).toContain(RolesGuard);
    // 配置写归硬件类
    for (const name of ['createDevice', 'updateDevice', 'removeDevice', 'upsertWhitelist', 'removeWhitelist', 'updatePlatformConfig']) {
      expect(Reflect.getMetadata(GUARDS_METADATA, proto[name])).toContain(ModuleAccessGuard);
      expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto[name])).toBe('lpr');
    }
  });

  it('keeps park-ops layout and brand body admin-only, while welcome editing stays open to operators/config', () => {
    const proto = SystemBrandingController.prototype as any;
    // 大屏布局（影响整屏显示）维持仅 admin
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.updateParkOps)).toContain(AdminGuard);
    // 品牌主体（系统名称 / Logo）走 branding 模块，矩阵里该模块 write/read 均空，仅 admin
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.update)).toContain(ModuleAccessGuard);
    expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto.update)).toBe('branding');
    // 欢迎页删图属于欢迎页编辑闭环（唯一调用方是前台 LED 编辑器）：改用 RolesGuard 白名单，
    // operator/config 仍能在前台删自己欢迎页图片；品牌主体收回 admin 不影响该闭环。
    expect(Reflect.getMetadata(GUARDS_METADATA, proto.removeWelcomeAsset)).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, proto.removeWelcomeAsset)).toEqual([
      'admin',
      'operator',
      'config',
    ]);
  });
});
