import type { UserRole } from '../../entities/user.entity';

/**
 * 后台分域 RBAC 矩阵（单一事实源，2026-10-13）。
 *
 * 设计原则：
 * - admin 永远全通（读+写），无需在矩阵中列出。
 * - 每个后台「模块」对应一个分域。新增后台功能时在此登记其可写角色。
 * - write：可写角色（POST/PUT/PATCH/DELETE），同时在后台可见该模块。
 * - read：在后台「只读可见」的角色，仅用于运维监控/日志这类公共排查页；
 *   业务分域不设只读（用户要求对方模块直接隐藏）。
 * - readRestricted：后端 GET 是否也限制为后台角色。
 *   · false（默认，前台共用读）：任何已登录用户（含 operator/viewer）都可 GET，
 *     因为 PWA 前台复用同一批读接口；写仍按 write 限制。
 *   · true（后台专属）：GET 也仅 admin + write + read 角色可访问。
 *
 * 前端菜单可见性 = admin 或 write 含该角色或 read 含该角色。
 */
export type AdminModule =
  | 'monitor'      // 运维监控（公共只读仪表盘）
  | 'alerts'       // 报警中心（设置类处置）
  | 'scenes'       // 场景管理 + 场景动作
  | 'scheduler'    // 定时任务
  | 'energy'       // 能源管理（含电源自动开关策略）
  | 'devices'      // 设备管理
  | 'hardware'     // 硬件清单（含驱动、品牌）
  | 'zones'        // 分区配置（灯光分区、电源回路、音频配置）
  | 'video'        // 视频绑定
  | 'lpr'          // 车牌道闸
  | 'diagnostics'  // 日志中心、审计（读）
  | 'uat'          // 测试 / 调试、UAT 验收（硬件动作页，仅硬件工程师）
  | 'metrics'      // 运营数据
  | 'branding'     // 系统品牌 / 欢迎页
  | 'app-release'  // APP 版本发布（运营开关 config 可写；版本号/下载地址仅 admin/CI）
  | 'system';      // 用户管理、常规系统设置、iOS 测试、审计（仅 admin）

interface ModuleAccessRule {
  /** 可写角色（admin 自动全通，无需列出）。 */
  write: UserRole[];
  /** 后台只读可见角色（用于公共排查页，业务分域默认留空）。 */
  read?: UserRole[];
  /** 后端 GET 是否限制为后台角色（true=后台专属，前台 PWA 不读）。 */
  readRestricted?: boolean;
}

const HARDWARE: UserRole = 'hardware';
const CONFIG: UserRole = 'config';
const OPERATOR: UserRole = 'operator';

export const MODULE_ACCESS: Record<AdminModule, ModuleAccessRule> = {
  // 公共只读：两个后台专员都要看运行态势；无写操作。
  monitor: { write: [], read: [HARDWARE, CONFIG], readRestricted: false },

  // 设置类（日常运行策略 / 内容）
  alerts: { write: [CONFIG] },
  scenes: { write: [CONFIG] },
  scheduler: { write: [CONFIG], readRestricted: true },
  energy: { write: [CONFIG] },
  metrics: { write: [CONFIG] },
  // 品牌管理（系统名称 / Logo / 品牌标识）仅管理员；运营/硬件角色在后台菜单中隐藏。
  // 注意：欢迎页内容（welcome-schemes / welcome 就地编辑 / welcome-assets 删图）走独立
  // RolesGuard 白名单（admin/operator/config），不归本模块，前台 LED 欢迎页编辑不受影响。
  branding: { write: [], read: [], readRestricted: true },
  // APP 版本：运营开关(启停/强制更新/最低兼容/更新说明) config 可写, hardware 只读核对；
  // 版本号/下载地址由 CI/受控部署流程维护, 非 admin 在 controller 层再硬隔离(改不了技术字段)。
  // operator(展厅操作员) 只读：登录后台仅为下载 APK, 不给任何写权限。
  'app-release': { write: [CONFIG], read: [HARDWARE, CONFIG, OPERATOR], readRestricted: true },

  // 硬件类（物理设备 / 接线 / 分区 / 道闸 / 调试）
  devices: { write: [HARDWARE] },
  hardware: { write: [HARDWARE] },
  zones: { write: [HARDWARE] },
  video: { write: [HARDWARE] },
  lpr: { write: [HARDWARE] },
  // 日志/审计读：两个专员都可排查；日志清理等写归硬件类。
  diagnostics: { write: [HARDWARE], read: [HARDWARE, CONFIG], readRestricted: true },
  // 测试/调试(UAT)是硬件动作页：仅 hardware 可见可写, 不给 config 只读(直接隐藏)。
  uat: { write: [HARDWARE], readRestricted: true },

  // 系统类：仅 admin。
  system: { write: [], read: [], readRestricted: true },
};

const READ_METHODS = ['GET', 'HEAD', 'OPTIONS'];

export function isReadMethod(method?: string): boolean {
  return READ_METHODS.includes((method ?? 'GET').toUpperCase());
}

/** 是否可写某模块（admin 全通）。 */
export function canWriteModule(role: UserRole | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  return !!role && MODULE_ACCESS[module].write.includes(role);
}

/** 后台菜单/页面是否可见（admin 或 write 或 read）。 */
export function canAccessModule(role: UserRole | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  const rule = MODULE_ACCESS[module];
  return rule.write.includes(role) || (rule.read ?? []).includes(role);
}

/** 后端 GET 是否放行（readRestricted 时仅后台可见角色）。 */
export function canReadModule(role: UserRole | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  const rule = MODULE_ACCESS[module];
  if (!rule.readRestricted) return true; // 前台共用读：任何已登录用户放行
  return rule.write.includes(role) || (rule.read ?? []).includes(role);
}
