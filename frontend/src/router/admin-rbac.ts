import type { UserRole } from '@/types/api';

/**
 * 前端后台分域 RBAC 镜像（与后端 backend/src/common/auth/rbac.ts 保持一致）。
 * 只用于菜单可见性 / 路由守卫 / 按钮置灰；真正的安全边界在后端 ModuleAccessGuard。
 *
 * - admin 全通。
 * - write：可写且可见的角色。
 * - read：后台只读可见（仅公共排查页：监控/日志）。
 * 用户已拍板：对方业务模块不给只读、直接隐藏。
 *
 * 2026-10-16 第三轮现场核对后最终口径：
 * - hardware（硬件工程师）：power-timing 写（调设备时间）+ 监控总览只读；其余收归 admin。
 * - config（运营配置员）：后台只有 power-timing（自动开关/4G 远程开关定时）一页，
 *   登录即落地该页；场景/定时/告警/指标/APP 发布/监控全部不可见，收归 admin。
 * - devices/hardware/zones/video/lpr/uat/diagnostics 全部收归 admin。
 * - operator 后台仅 app-release 只读下载 APK（+ 自助改密码）。
 */
export type AdminModule =
  | 'monitor'
  | 'alerts'
  | 'scenes'
  | 'scheduler'
  | 'energy'
  | 'power-timing'
  | 'devices'
  | 'hardware'
  | 'zones'
  | 'video'
  | 'lpr'
  | 'diagnostics'
  | 'uat'
  | 'metrics'
  | 'branding'
  | 'app-release'
  | 'system';

interface ModuleRule {
  write: UserRole[];
  read?: UserRole[];
}

const HARDWARE: UserRole = 'hardware';
const CONFIG: UserRole = 'config';
const OPERATOR: UserRole = 'operator';

export const MODULE_RULES: Record<AdminModule, ModuleRule> = {
  // 公共只读监控总览：第三轮起仅 hardware 只读；config 不可见（其后台只有自动开关）。
  monitor: { write: [], read: [HARDWARE] },
  // 运营内容（场景/定时/告警/指标）：第三轮全部收归 admin，config 不再可写/不可见。
  alerts: { write: [] },
  scenes: { write: [] },
  scheduler: { write: [] },
  // 能源台账/电表/变压器等工程配置：仅 admin；
  // 不在 read 给任何角色 -> 后台菜单对非 admin 隐藏（前台/大屏能源读接口仍共用）。
  energy: { write: [] },
  // 自动开关/4G 远程开关定时：config 主责，hardware 也可写。
  'power-timing': { write: [HARDWARE, CONFIG] },
  // 运营指标（实时过车等）：写收归 admin；前台大屏只读共用接口不受影响。
  metrics: { write: [] },
  // 品牌管理（系统名称 / Logo / 品牌标识）仅管理员，运营/硬件角色菜单隐藏；
  // 欢迎页内容编辑在前台 LED，走独立角色白名单，不归本模块。
  branding: { write: [], read: [] },
  // APP 版本：第三轮起运营开关也收归 admin；operator(展厅操作员)只读下载 APK。
  // 版本号/下载地址由 CI/受控部署维护, 前端按是否 admin 再置灰技术字段。
  'app-release': { write: [], read: [OPERATOR] },
  // 硬件类全部收归 admin：设备/硬件清单/分区/视频绑定/道闸/诊断/UAT。
  devices: { write: [] },
  hardware: { write: [] },
  zones: { write: [] },
  video: { write: [] },
  lpr: { write: [] },
  diagnostics: { write: [], read: [] },
  // 测试/调试(UAT)收归 admin，非 admin 后台菜单隐藏。
  uat: { write: [] },
  system: { write: [], read: [] },
};

/** 内置角色 code 集合（动态 RBAC 上线前的 5 个写死角色）。 */
export const BUILTIN_ROLE_CODES: readonly string[] = [
  'admin',
  'hardware',
  'config',
  'operator',
  'viewer',
];

/** 可登录后台的角色（operator 仅自助改密码 + 只读下载 APK，其余模块隐藏）。 */
export const BACKEND_ROLES: UserRole[] = ['admin', 'hardware', 'config', 'operator'];

/**
 * 后台分域 → 原子权限点（动态 RBAC）。
 * 内置 5 角色仍走 MODULE_RULES 矩阵（零行为变化）；管理员新建的自定义角色
 * 按其勾选的权限点判定后台菜单可见性 / 可写性。
 * 拥有数组内任一权限点即视为该模块可见。
 */
const MODULE_VIEW_PERMISSION: Record<AdminModule, readonly string[]> = {
  monitor: ['monitor:view', 'monitor:diagnose'],
  alerts: ['alerts:manage'],
  scenes: ['scenes:manage'],
  scheduler: ['scheduler:manage'],
  energy: ['energy:ledger'],
  'power-timing': ['power-timing:manage'],
  devices: ['devices:manage'],
  hardware: ['hardware:manage'],
  zones: ['zones:manage'],
  video: ['video:manage'],
  lpr: ['lpr:manage'],
  diagnostics: ['diagnostics:view'],
  uat: ['uat:access'],
  metrics: ['metrics:view'],
  branding: ['branding:manage'],
  'app-release': ['app-release:view', 'app-release:manage'],
  system: ['system:settings', 'user:manage', 'role:manage'],
};

/** 后台分域 → 可写所需权限点（拥有任一即可写）。 */
const MODULE_WRITE_PERMISSION: Record<AdminModule, readonly string[]> = {
  monitor: ['monitor:diagnose'],
  alerts: ['alerts:manage'],
  scenes: ['scenes:manage'],
  scheduler: ['scheduler:manage'],
  energy: ['energy:ledger'],
  'power-timing': ['power-timing:manage'],
  devices: ['devices:manage'],
  hardware: ['hardware:manage'],
  zones: ['zones:manage'],
  video: ['video:manage'],
  lpr: ['lpr:manage'],
  diagnostics: ['diagnostics:view'],
  uat: ['uat:access'],
  metrics: ['metrics:view'],
  branding: ['branding:manage'],
  'app-release': ['app-release:manage'],
  system: ['system:settings', 'user:manage', 'role:manage'],
};

/** 自定义角色登录后台后的落地页优先级（按后台导航顺序取第一个有权限的模块）。 */
const ADMIN_LANDING_PRIORITY: readonly AdminModule[] = [
  'monitor',
  'alerts',
  'metrics',
  'scenes',
  'scheduler',
  'lpr',
  'energy',
  'power-timing',
  'hardware',
  'devices',
  'zones',
  'video',
  'diagnostics',
  'uat',
  'system',
  'branding',
  'app-release',
];

function hasAny(perms: ReadonlySet<string>, codes: readonly string[]): boolean {
  return codes.some((c) => perms.has(c));
}

/** 后台菜单可见性（内置角色走旧矩阵，自定义角色走权限点）。 */
export function canAccessAdminModuleByPerms(
  role: string | undefined,
  perms: ReadonlySet<string>,
  module: AdminModule,
): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  // 动态 RBAC：统一以权限点为准（与后端 /me 一致，内置角色增/减权限即时生效）。
  return hasAny(perms, MODULE_VIEW_PERMISSION[module]);
}

/** 后台分域可写（内置角色走旧矩阵，自定义角色走权限点）。 */
export function canWriteAdminModuleByPerms(
  role: string | undefined,
  perms: ReadonlySet<string>,
  module: AdminModule,
): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  // 动态 RBAC：统一以权限点为准（与后端 /me 一致，内置角色增/减权限即时生效）。
  return hasAny(perms, MODULE_WRITE_PERMISSION[module]);
}

/** 自定义角色登录后台的默认落地路由名（取第一个有权限的模块）。 */
export function defaultAdminRouteByPerms(role: string | undefined, perms: ReadonlySet<string>): string {
  if (role === 'admin' || (role && BUILTIN_ROLE_CODES.includes(role))) {
    return defaultAdminRoute(role as UserRole);
  }
  const moduleToRoute: Partial<Record<AdminModule, string>> = {
    monitor: 'admin-monitor',
    alerts: 'admin-alerts',
    metrics: 'admin-park-ops-metrics',
    scenes: 'admin-scenes',
    scheduler: 'admin-scheduler',
    lpr: 'admin-lpr',
    energy: 'admin-energy',
    'power-timing': 'admin-auto-switch',
    hardware: 'admin-hardware',
    devices: 'admin-devices',
    zones: 'admin-zones-config',
    video: 'admin-video-binding',
    diagnostics: 'admin-logs',
    uat: 'admin-test-center',
    system: 'admin-settings',
    branding: 'admin-system-branding',
    'app-release': 'admin-app-release',
  };
  for (const module of ADMIN_LANDING_PRIORITY) {
    if (hasAny(perms, MODULE_VIEW_PERMISSION[module])) {
      return moduleToRoute[module] ?? 'admin-change-password';
    }
  }
  // 没有任何后台模块权限：落到自助改密码页（任何可登录后台的角色都可访问）。
  return 'admin-change-password';
}

/** 后台菜单/页面是否可见（admin 或在 write/read 中）。 */
export function canAccessAdminModule(role: UserRole | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  const rule = MODULE_RULES[module];
  return rule.write.includes(role) || (rule.read ?? []).includes(role);
}

/** 是否可写某模块（admin 或在 write 中）。 */
export function canWriteAdminModule(role: UserRole | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  return !!role && MODULE_RULES[module].write.includes(role);
}

/** 某角色登录后台后的默认落地页（路由 name）。 */
export function defaultAdminRoute(role: UserRole | undefined): string {
  // hardware 后台只保留自动开关(power-timing) + 监控总览只读，落地页为自动开关。
  if (role === 'hardware') return 'admin-auto-switch';
  // config 后台只有自动开关一页，登录直接落地该页。
  if (role === 'config') return 'admin-auto-switch';
  // 展厅操作员登录后台仅为下载 APK，直接落到 APP 版本页。
  if (role === 'operator') return 'admin-app-release';
  return 'admin-monitor';
}

export const ROLE_LABELS: Record<UserRole, string> = {
  admin: '管理员',
  hardware: '硬件工程师',
  config: '运营配置员',
  operator: '展厅操作员',
  viewer: '只读账户',
};
