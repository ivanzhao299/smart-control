import type { UserRole } from '../../entities/user.entity';

/**
 * 后台分域 RBAC 矩阵（单一事实源，2026-10-16 第二轮最小权限收敛）。
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
 *
 * 2026-10-16 三角色最小权限（误触「全场静音」事故后收敛）：
 * - operator（展厅操作员）：只做前台播控/素材/场景；后台仅下载 APK + 改密码。
 * - hardware（设备管理员）：后台只保留「自动开关」(power-timing) 调设备时间 +
 *   监控总览只读；其余设备/分区/道闸/调试/诊断全部收归 admin。
 * - config（运营配置员）：保留运营内容（场景/定时/告警/指标/APP 发布）；
 *   能源台账/电表等工程配置收归 admin。
 * - 前台设备实体控制（音响/灯光/LED/电源/道闸/空调）改由各 controller 上的
 *   RolesGuard 直接限制，不走本后台矩阵；详见各控制器。
 */
export type AdminModule =
  | 'monitor'      // 运维监控（公共只读仪表盘）
  | 'alerts'       // 报警中心（设置类处置）
  | 'scenes'       // 场景管理 + 场景动作
  | 'scheduler'    // 定时任务（场景定时）
  | 'energy'       // 能源管理（台账/电表/变压器，仅 admin；读接口前台共用）
  | 'power-timing' // 电源自动开关 / 定时通断（设备管理员调设备时间，唯一保留写权限）
  | 'devices'      // 设备管理（仅 admin）
  | 'hardware'     // 硬件清单（含驱动、品牌，仅 admin）
  | 'zones'        // 分区配置（灯光分区、电源回路、音频配置，仅 admin）
  | 'video'        // 视频绑定（仅 admin）
  | 'lpr'          // 车牌道闸（仅 admin）
  | 'diagnostics'  // 日志中心、审计（仅 admin）
  | 'uat'          // 测试 / 调试、UAT 验收（仅 admin）
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
  // 公共只读：硬件(保留运行态势)与运营专员都看；无写操作。
  monitor: { write: [], read: [HARDWARE, CONFIG], readRestricted: false },

  // 设置类（运营内容 / 日常运行策略）—— config 保留。
  alerts: { write: [CONFIG] },
  scenes: { write: [CONFIG] },
  scheduler: { write: [CONFIG], readRestricted: true },
  // 能源台账/电表/变压器：工程类配置，2026-10-16 收归 admin（config 不再写）。
  // 不设 readRestricted，运营大屏/PWA 的能源只读取数（前台共用读）不受影响。
  energy: { write: [] },
  metrics: { write: [CONFIG] },
  // 品牌管理（系统名称 / Logo / 品牌标识）仅管理员；运营/硬件角色在后台菜单中隐藏。
  // 注意：欢迎页内容（welcome-schemes / welcome 就地编辑 / welcome-assets 删图）走独立
  // RolesGuard 白名单（admin/operator/config），不归本模块，前台 LED 欢迎页编辑不受影响。
  branding: { write: [], read: [], readRestricted: true },
  // APP 版本：运营开关(启停/强制更新/最低兼容/更新说明) config 可写；
  // 版本号/下载地址由 CI/受控部署流程维护, 非 admin 在 controller 层再硬隔离(改不了技术字段)。
  // operator(展厅操作员) 只读：登录后台仅为下载 APK, 不给任何写权限。
  // hardware 不再只读（其后台只保留自动开关 + 监控总览）。
  'app-release': { write: [CONFIG], read: [CONFIG, OPERATOR], readRestricted: true },

  // 设备管理员 hardware 唯一保留的写权限：电源回路自动开关/定时通断（调设备时间）。
  // 写端点 power-schedules（@ModuleAccess('power-timing')）；回路/规则读仍走前台共用读。
  'power-timing': { write: [HARDWARE] },

  // 硬件类（物理设备 / 接线 / 分区 / 道闸 / 调试 / 诊断）：2026-10-16 全部收归 admin。
  // hardware 仅保留上方 power-timing，避免误触设备配置与道闸。
  devices: { write: [] },
  hardware: { write: [] },
  zones: { write: [] },
  video: { write: [] },
  lpr: { write: [] },
  diagnostics: { write: [], read: [], readRestricted: true },
  uat: { write: [], readRestricted: true },

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
