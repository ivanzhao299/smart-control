import type { UserRole } from '@/types/api';

/**
 * 前端后台分域 RBAC 镜像（与后端 backend/src/common/auth/rbac.ts 保持一致）。
 * 只用于菜单可见性 / 路由守卫 / 按钮置灰；真正的安全边界在后端 ModuleAccessGuard。
 *
 * - admin 全通。
 * - write：可写且可见的角色。
 * - read：后台只读可见（仅公共排查页：监控/日志）。
 * 用户已拍板：对方业务模块不给只读、直接隐藏。
 */
export type AdminModule =
  | 'monitor'
  | 'alerts'
  | 'scenes'
  | 'scheduler'
  | 'energy'
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
  monitor: { write: [], read: [HARDWARE, CONFIG] },
  alerts: { write: [CONFIG] },
  scenes: { write: [CONFIG] },
  scheduler: { write: [CONFIG] },
  energy: { write: [CONFIG] },
  metrics: { write: [CONFIG] },
  // 品牌管理（系统名称 / Logo / 品牌标识）仅管理员，运营/硬件角色菜单隐藏；
  // 欢迎页内容编辑在前台 LED，走独立角色白名单，不归本模块。
  branding: { write: [], read: [] },
  // APP 版本：config 改运营开关(启停/强制更新/最低兼容/更新说明), hardware 只读核对,
  // operator(展厅操作员)只读下载 APK; 版本号/下载地址由 CI/受控部署维护, 前端按是否
  // admin 再置灰技术字段。
  'app-release': { write: [CONFIG], read: [HARDWARE, CONFIG, OPERATOR] },
  devices: { write: [HARDWARE] },
  hardware: { write: [HARDWARE] },
  zones: { write: [HARDWARE] },
  video: { write: [HARDWARE] },
  lpr: { write: [HARDWARE] },
  diagnostics: { write: [HARDWARE], read: [HARDWARE, CONFIG] },
  // 测试/调试(UAT)是硬件动作页, 不给 config 只读, 直接隐藏; 仅 hardware 可见可写。
  uat: { write: [HARDWARE] },
  system: { write: [], read: [] },
};

/** 可登录后台的角色（operator 仅自助改密码 + 只读下载 APK，其余模块隐藏）。 */
export const BACKEND_ROLES: UserRole[] = ['admin', 'hardware', 'config', 'operator'];

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
  if (role === 'hardware') return 'admin-devices';
  if (role === 'config') return 'admin-scenes';
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
