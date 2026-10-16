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
import { WRITE_ROLES_KEY } from '../decorators/write-roles.decorator';
import { ModuleAccessGuard } from '../guards/module-access.guard';
import { ActorAdminGuard } from '../guards/actor-admin.guard';
import { RolesGuard } from '../guards/roles.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { WriteRoleGuard } from '../guards/write-role.guard';
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
import { AudioController } from '../../modules/audio/audio.controller';
import { LightingController } from '../../modules/lighting/lighting.controller';
import { LedController } from '../../modules/led/led.controller';
import { ProjectorController } from '../../modules/projector/projector.controller';
import { HvacController } from '../../modules/hvac/hvac.controller';
import { DaliLightsController } from '../../modules/dali-lights/dali-lights.controller';
import { PowerCircuitsController } from '../../modules/power-circuits/power-circuits.controller';
import { PowerSchedulesController } from '../../modules/power-schedules/power-schedules.controller';
import { LightZonesController } from '../../modules/light-zones/light-zones.controller';
import { AlertController } from '../../modules/alerts/alert.controller';
import { AuditController } from '../../modules/audit/audit.controller';
import { LprController } from '../../modules/lpr/lpr.controller';
import { SystemBrandingController } from '../../modules/system-branding/system-branding.controller';
import { AppReleaseController } from '../../modules/app-release/app-release.controller';

const ALL_MODULES: AdminModule[] = [
  'monitor', 'alerts', 'scenes', 'scheduler', 'energy', 'power-timing',
  'devices', 'hardware', 'zones', 'video', 'lpr', 'diagnostics', 'uat',
  'metrics', 'branding', 'app-release', 'system',
];

describe('RBAC module matrix (2026-10-16 least-privilege)', () => {
  it('admin always has full access to all 17 modules', () => {
    for (const m of ALL_MODULES) {
      expect(canWriteModule('admin', m)).toBe(true);
      expect(canReadModule('admin', m)).toBe(true);
      expect(canAccessModule('admin', m)).toBe(true);
    }
  });

  it('hardware only keeps power-timing write + monitor read-only', () => {
    // 唯一保留写权限：电源自动开关/定时通断（调设备时间）。
    expect(canWriteModule('hardware', 'power-timing')).toBe(true);
    // 监控总览只读（保留运行态势）。
    expect(canReadModule('hardware', 'monitor')).toBe(true);
    expect(canAccessModule('hardware', 'monitor')).toBe(true);
    // 其余设备/硬件/分区/道闸/调试/诊断/能源全部收归 admin。
    for (const m of [
      'devices', 'hardware', 'zones', 'video', 'lpr', 'diagnostics',
      'uat', 'energy', 'alerts', 'scenes', 'scheduler', 'metrics',
      'branding', 'system', 'app-release',
    ] as AdminModule[]) {
      expect(canWriteModule('hardware', m)).toBe(false);
      expect(canAccessModule('hardware', m)).toBe(false);
    }
    // 系统/品牌/调试/诊断类对硬件工程师完全隐藏。
    expect(canReadModule('hardware', 'system')).toBe(false);
    expect(canReadModule('hardware', 'branding')).toBe(false);
    expect(canReadModule('hardware', 'diagnostics')).toBe(false);
    expect(canReadModule('hardware', 'uat')).toBe(false);
    // APP 版本不再对硬件工程师只读（其后台只剩自动开关 + 监控总览）。
    expect(canReadModule('hardware', 'app-release')).toBe(false);
  });

  it('config only keeps power-timing write; scenes/scheduler/alerts/metrics/app-release reclaimed by admin', () => {
    // 第三轮现场核对：config 后台只有「自动开关」(power-timing) 一页可写。
    expect(canWriteModule('config', 'power-timing')).toBe(true);
    expect(canAccessModule('config', 'power-timing')).toBe(true);
    // 场景/定时/告警/指标/APP 发布全部收归 admin，config 菜单不可见。
    for (const m of ['alerts', 'scenes', 'scheduler', 'metrics', 'app-release'] as AdminModule[]) {
      expect(canWriteModule('config', m)).toBe(false);
      expect(canAccessModule('config', m)).toBe(false);
    }
    // scenes/alerts/metrics 未设 readRestricted：前台 PWA 仍需 GET 场景列表/大屏指标，
    // 只收写不收读（config 作为登录角色 GET 仍放行，但后台菜单不可见）。
    expect(canReadModule('config', 'scenes')).toBe(true);
    expect(canReadModule('config', 'metrics')).toBe(true);
    // scheduler 是后台专属（readRestricted），config 不可读。
    expect(canReadModule('config', 'scheduler')).toBe(false);
    // app-release 收归 admin，config 不可读（后台专属）。
    expect(canReadModule('config', 'app-release')).toBe(false);
    // 能源台账/电表/变压器工程配置收归 admin。
    expect(canWriteModule('config', 'energy')).toBe(false);
    expect(canAccessModule('config', 'energy')).toBe(false);
    // 品牌仅 admin。
    expect(canWriteModule('config', 'branding')).toBe(false);
    expect(canAccessModule('config', 'branding')).toBe(false);
    // 硬件类全部不可见。
    for (const m of ['devices', 'hardware', 'zones', 'video', 'lpr', 'uat'] as AdminModule[]) {
      expect(canWriteModule('config', m)).toBe(false);
      expect(canAccessModule('config', m)).toBe(false);
    }
    // 诊断/测试收归 admin。
    expect(canReadModule('config', 'diagnostics')).toBe(false);
    expect(canReadModule('config', 'uat')).toBe(false);
    expect(canAccessModule('config', 'system')).toBe(false);
    // 第三轮：监控总览对 config 也不可见（菜单隐藏；monitor 未设 readRestricted，
    // 后端 GET 仍按前台共用读放行，见下一个用例）。
    expect(canAccessModule('config', 'monitor')).toBe(false);
  });

  it('operator/viewer cannot write any backend module; operator only reads app-release', () => {
    for (const role of ['operator', 'viewer'] as const) {
      for (const m of ALL_MODULES) {
        expect(canWriteModule(role, m)).toBe(false);
      }
      // 后台专属只读（调度/日志/测试/品牌/系统）不放前台角色。
      for (const m of ['scheduler', 'diagnostics', 'uat', 'branding', 'system', 'app-release'] as AdminModule[]) {
        expect(canReadModule(role, m)).toBe(m === 'app-release' && role === 'operator');
      }
    }
    // operator 对 app-release 只读（下载 APK + 改密码是其后台仅有的动作）。
    expect(canReadModule('operator', 'app-release')).toBe(true);
    expect(canAccessModule('operator', 'app-release')).toBe(true);
    expect(canReadModule('viewer', 'app-release')).toBe(false);
  });

  it('front-stage shared reads stay open when readRestricted is not set', () => {
    // 能源/设备/监控前台共用读：任何登录角色（含 viewer）都可读，运营大屏不被破坏。
    expect(canReadModule('viewer', 'energy')).toBe(true);
    expect(canReadModule('operator', 'devices')).toBe(true);
    expect(canReadModule('viewer', 'monitor')).toBe(true);
    // power-timing 无 readRestricted、无 read 角色，菜单可见性只看 write：hardware 与 config 都可写。
    expect(canAccessModule('hardware', 'power-timing')).toBe(true);
    expect(canAccessModule('config', 'power-timing')).toBe(true);
    // monitor 未设 readRestricted（前台共用读）：任何登录角色 GET 都放行，
    // 与"后台菜单对 config 隐藏"（canAccessModule=false）解耦。
    expect(canReadModule('config', 'monitor')).toBe(true);
  });
});

describe('RBAC controller bindings', () => {
  const classGuards = (controller: Function) =>
    (Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[]) ?? [];
  const classModule = (controller: Function) =>
    Reflect.getMetadata(MODULE_ACCESS_KEY, controller) as AdminModule | undefined;
  const classWriteRoles = (controller: Function) =>
    Reflect.getMetadata(WRITE_ROLES_KEY, controller) as string[] | undefined;
  const methodGuards = (proto: any, name: string) =>
    (Reflect.getMetadata(GUARDS_METADATA, proto[name]) ?? []) as unknown[];
  const methodWriteRoles = (proto: any, name: string) =>
    Reflect.getMetadata(WRITE_ROLES_KEY, proto[name]) as string[] | undefined;

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

  // 方法级 ModuleAccess 收集（CRUD/处置端点）。
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

  it('governs power-schedules writes by power-timing only (hardware + config)', () => {
    // 第三轮：自动开关/定时通断统一收归 power-timing，写权限给 hardware + config（矩阵角色控制）。
    expect(boundModules(PowerSchedulesController)).toEqual(new Set<AdminModule>(['power-timing']));
    expect(classModule(PowerSchedulesController)).toBeUndefined();
  });

  it('keeps zones CRUD (power circuits / light zones / audio config) under ModuleAccess(zones)', () => {
    expect(boundModules(PowerCircuitsController).has('zones')).toBe(true);
    expect(boundModules(LightZonesController).has('zones')).toBe(true);
    expect(boundModules(AudioConfigController).has('zones')).toBe(true);
    // 灯光分区类级也收口。
    expect(classGuards(LightZonesController)).toContain(ModuleAccessGuard);
    expect(classModule(LightZonesController)).toBe('zones');
  });

  it('locks alert handling to ModuleAccess(alerts)', () => {
    expect(classGuards(AlertController)).toContain(ModuleAccessGuard);
    expect(classModule(AlertController)).toBe('alerts');
  });

  it('restricts non-playback device entity controllers to admin via class-level WriteRoleGuard', () => {
    // 音响 / 灯光 / 空调 / DALI：类级写仅 admin（误触全场静音事故后收口）。
    // LED 属大屏播控（开/关屏、切信号、播内容），第三轮放开给 operator，见下方专门用例。
    for (const c of [AudioController, LightingController, HvacController, DaliLightsController]) {
      expect(classGuards(c)).toContain(WriteRoleGuard);
      expect(classWriteRoles(c)).toEqual(['admin']);
    }
  });

  it('opens projector playback to admin/operator at class level', () => {
    expect(classGuards(ProjectorController)).toContain(WriteRoleGuard);
    expect(classWriteRoles(ProjectorController)).toEqual(['admin', 'operator']);
  });

  it('opens all LED playback endpoints (on/off/play/welcome/input) to admin/operator at class level', () => {
    // 第三轮：LED 开/关屏、切信号源、播内容、欢迎页都是大屏播控，类级统一 admin/operator。
    expect(classGuards(LedController)).toContain(WriteRoleGuard);
    expect(classWriteRoles(LedController)).toEqual(['admin', 'operator']);
    const proto = LedController.prototype as any;
    // 各播控端点继承类级，不再需要方法级 @WriteRoles 覆盖（welcome 仍保留方法体内 assertCanUpload）。
    expect(methodWriteRoles(proto, 'welcome')).toBeUndefined();
    expect(methodWriteRoles(proto, 'input')).toBeUndefined();
    expect(methodWriteRoles(proto, 'on')).toBeUndefined();
    expect(methodWriteRoles(proto, 'off')).toBeUndefined();
  });

  it('allows power-circuit on/off to admin+hardware but sequencer and CRUD stay admin/zones', () => {
    const proto = PowerCircuitsController.prototype as any;
    // 单路手动通断：admin + hardware（设备测试）。
    expect(methodGuards(proto, 'on')).toContain(WriteRoleGuard);
    expect(methodWriteRoles(proto, 'on')).toEqual(['admin', 'hardware']);
    expect(methodGuards(proto, 'off')).toContain(WriteRoleGuard);
    expect(methodWriteRoles(proto, 'off')).toEqual(['admin', 'hardware']);
    // 时序器一键全开/全关：仅 admin。
    expect(methodWriteRoles(proto, 'seqAllOn')).toEqual(['admin']);
    expect(methodWriteRoles(proto, 'seqAllOff')).toEqual(['admin']);
    // 回路 CRUD 归 zones（仅 admin，矩阵 zones.write 为空）。
    expect(boundModules(PowerCircuitsController).has('zones')).toBe(true);
  });

  it('guards scene config CRUD to ModuleAccess(scenes) but execute/stop/cancel to admin/operator', () => {
    const proto = ScenesController.prototype as any;
    for (const name of ['create', 'update', 'remove', 'testExecute']) {
      expect(methodGuards(proto, name)).toContain(ModuleAccessGuard);
      expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto[name])).toBe('scenes');
    }
    for (const name of ['execute', 'stop', 'cancel']) {
      expect(methodGuards(proto, name)).toContain(WriteRoleGuard);
      expect(methodWriteRoles(proto, name)).toEqual(['admin', 'operator']);
    }
  });

  it('locks LPR gate open/close and admin device list to admin, keeps CRUD under ModuleAccess(lpr)', () => {
    const proto = LprController.prototype as any;
    for (const name of ['openGate', 'closeGate']) {
      expect(methodGuards(proto, name)).toContain(WriteRoleGuard);
      expect(methodWriteRoles(proto, name)).toEqual(['admin']);
    }
    // 含相机后台口令的管理列表：仅 admin。
    expect(methodGuards(proto, 'adminDevices')).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, proto.adminDevices)).toEqual(['admin']);
    // 平台/设备/白名单 CRUD 归 lpr 模块（矩阵 lpr.write 为空，仅 admin）。
    expect(boundModules(LprController).has('lpr')).toBe(true);
  });

  it('app release admin endpoints drop AdminGuard for module-scoped access while public download/latest stay open', () => {
    const proto = AppReleaseController.prototype as any;
    for (const name of ['list', 'detail', 'upsert']) {
      const guards = methodGuards(proto, name);
      expect(guards).toContain(ModuleAccessGuard);
      expect(guards).not.toContain(AdminGuard);
      expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto[name])).toBe('app-release');
    }
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.download)).toBe(true);
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, proto.latest)).toBe(true);
  });

  it('keeps system-only controllers under admin guard', () => {
    expect(classGuards(AuditController)).toContain(ActorAdminGuard);
  });

  it('keeps park-ops layout and brand body admin-only, while welcome editing stays open to operators/config', () => {
    const proto = SystemBrandingController.prototype as any;
    expect(methodGuards(proto, 'updateParkOps')).toContain(AdminGuard);
    expect(methodGuards(proto, 'update')).toContain(ModuleAccessGuard);
    expect(Reflect.getMetadata(MODULE_ACCESS_KEY, proto.update)).toBe('branding');
    expect(methodGuards(proto, 'removeWelcomeAsset')).toContain(RolesGuard);
    expect(Reflect.getMetadata(ROLES_KEY, proto.removeWelcomeAsset)).toEqual([
      'admin',
      'operator',
      'config',
    ]);
  });

  it('grants module-scoped access when the role can write the listed module', async () => {
    const mkGuard = (modules: AdminModule | AdminModule[], role: string, method = 'POST') => {
      const reflector = { getAllAndOverride: () => modules } as any;
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
    // hardware / config 都可写 power-timing（自动开关/4G 远程开关定时）。
    await expect(mkGuard('power-timing', 'hardware')).resolves.toBe(true);
    await expect(mkGuard('power-timing', 'config')).resolves.toBe(true);
    // admin 全通。
    await expect(mkGuard('power-timing', 'admin')).resolves.toBe(true);
    // scenes 第三轮收归 admin：config / hardware 都不能写。
    await expect(mkGuard('scenes', 'config')).rejects.toThrow();
    await expect(mkGuard('scenes', 'hardware')).rejects.toThrow();
    // operator/viewer 一律拒。
    await expect(mkGuard('power-timing', 'operator')).rejects.toThrow();
    await expect(mkGuard('power-timing', 'viewer')).rejects.toThrow();
  });
});

describe('WriteRoleGuard behavior', () => {
  const mkGuard = (roles: string[] | undefined, method: string, actorRole: string) => {
    const reflector = {
      getAllAndOverride: () => roles,
    } as any;
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => ({
          method,
          actor: { kind: 'user', userId: 2, username: 'op1', role: actorRole },
        }),
      }),
      getHandler: () => ({}),
      getClass: () => ({}),
    } as any;
    return new WriteRoleGuard(reflector).canActivate(ctx);
  };

  it('always passes read methods regardless of role', () => {
    expect(mkGuard(['admin'], 'GET', 'viewer')).toBe(true);
    expect(mkGuard(['admin'], 'HEAD', 'operator')).toBe(true);
    expect(mkGuard(['admin'], 'OPTIONS', 'hardware')).toBe(true);
  });

  it('passes when no write roles are declared', () => {
    expect(mkGuard(undefined, 'POST', 'viewer')).toBe(true);
    expect(mkGuard([], 'POST', 'viewer')).toBe(true);
  });

  it('passes write when role is whitelisted, rejects otherwise', () => {
    // 设备类（admin only）：operator/hardware/viewer 写都被拒。
    expect(mkGuard(['admin'], 'POST', 'admin')).toBe(true);
    expect(() => mkGuard(['admin'], 'POST', 'operator')).toThrow();
    expect(() => mkGuard(['admin'], 'POST', 'hardware')).toThrow();
    expect(() => mkGuard(['admin'], 'POST', 'viewer')).toThrow();
    // 播控类（admin/operator）：operator 放行，hardware/viewer 拒绝。
    expect(mkGuard(['admin', 'operator'], 'POST', 'operator')).toBe(true);
    expect(mkGuard(['admin', 'operator'], 'POST', 'admin')).toBe(true);
    expect(() => mkGuard(['admin', 'operator'], 'POST', 'hardware')).toThrow();
    expect(() => mkGuard(['admin', 'operator'], 'POST', 'viewer')).toThrow();
    // 单路电源通断（admin/hardware）：hardware 放行，operator 拒绝。
    expect(mkGuard(['admin', 'hardware'], 'POST', 'hardware')).toBe(true);
    expect(() => mkGuard(['admin', 'hardware'], 'POST', 'operator')).toThrow();
  });
});
