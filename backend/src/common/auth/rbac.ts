import type { UserRole } from '../../entities/user.entity';

/**
 * 后台分域 RBAC 矩阵（单一事实源，2026-10-16 第三轮现场核对后收敛）。
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
 * 2026-10-16 第三轮（现场真实账号核对后的最终口径）：
 * - operator（展厅操作员）：只做前台大屏/投影播控（开/关屏、切信号源、播内容、
 *   欢迎页）、素材上传/改名、首页场景执行；后台仅 APP 版本只读下载 APK + 改密码。
 * - config（运营配置员）：后台**只有**「自动开关」(power-timing) 一页，负责
 *   4G 远程开关/自动开关定时时间设定，登录即落地该页；场景/定时/告警/指标/
 *   APP 发布/监控全部不可见，收归 admin。
 * - hardware（硬件工程师）：保留「自动开关」(power-timing) 调设备时间 +
 *   监控总览只读；其余设备/分区/道闸/调试/诊断全部收归 admin。
 * - 前台设备实体控制（音响/灯光/LED/电源/道闸/空调/投影）由各 controller 上的
 *   RolesGuard 直接限制，不走本后台矩阵；详见各控制器。
 */
export type AdminModule =
  | 'monitor'      // 运维监控（公共只读仪表盘）
  | 'alerts'       // 报警中心（设置类处置）
  | 'scenes'       // 场景管理 + 场景动作
  | 'scheduler'    // 定时任务（场景定时）
  | 'energy'       // 能源管理（台账/电表/变压器，仅 admin；读接口前台共用）
  | 'power-timing' // 自动开关 / 4G 远程开关定时（config 主责，hardware 也可写）
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
  // 公共只读监控：第三轮起仅 hardware 保留运行态势只读；config 不再可见（其后台只有自动开关）。
  monitor: { write: [], read: [HARDWARE], readRestricted: false },

  // 运营内容：场景/定时/告警/指标第三轮全部收归 admin（现场核对，config 不得新建场景、
  // 不得碰定时/告警/指标）。scenes/alerts/metrics 不设 readRestricted：前台 PWA 仍需 GET
  // 场景列表（operator 执行场景）、运营大屏仍需 GET 指标数据（实时过车等）；只收写、不收读。
  alerts: { write: [] },
  scenes: { write: [] },
  scheduler: { write: [], readRestricted: true },
  // 能源台账/电表/变压器：工程类配置，仅 admin；不设 readRestricted，
  // 运营大屏/PWA 的能源只读取数（前台共用读）不受影响。
  energy: { write: [] },
  metrics: { write: [] },
  // 品牌管理（系统名称 / Logo / 品牌标识）仅管理员；运营/硬件角色在后台菜单中隐藏。
  // 注意：欢迎页内容（welcome-schemes / welcome 就地编辑 / welcome-assets 删图）走独立
  // RolesGuard 白名单（admin/operator/config），不归本模块，前台 LED 欢迎页编辑不受影响。
  branding: { write: [], read: [], readRestricted: true },
  // APP 版本：第三轮起运营开关（启停/强制更新/最低兼容/更新说明）也收归 admin；
  // operator(展厅操作员) 只读：登录后台仅为下载 APK，不给任何写权限。
  // 版本号/下载地址由 CI/受控部署流程维护，非 admin 在 controller 层硬隔离(改不了技术字段)。
  'app-release': { write: [], read: [OPERATOR], readRestricted: true },

  // 自动开关 / 定时通断：config（运营配置员）主责设定 4G 远程开关/自动开关时间，
  // hardware（硬件工程师）同样保留调设备时间的写权限。
  // 写端点 power-schedules（@ModuleAccess('power-timing')）；回路/规则读仍走前台共用读。
  'power-timing': { write: [HARDWARE, CONFIG] },

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

/**
 * 是否可写某模块（admin 全通）。
 * 动态 RBAC 后 role 为普通字符串（可能是自定义角色）；未知角色不在硬编码矩阵内 → 默认拒绝。
 * 注：P3 起模块判定逐步迁移到 @RequirePermission，本矩阵为过渡兜底。
 */
export function canWriteModule(role: string | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  return !!role && MODULE_ACCESS[module].write.includes(role as UserRole);
}

/** 后台菜单/页面是否可见（admin 或 write 或 read）。 */
export function canAccessModule(role: string | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  const rule = MODULE_ACCESS[module];
  return rule.write.includes(role as UserRole) || (rule.read ?? []).includes(role as UserRole);
}

/** 后端 GET 是否放行（readRestricted 时仅后台可见角色）。 */
export function canReadModule(role: string | undefined, module: AdminModule): boolean {
  if (role === 'admin') return true;
  if (!role) return false;
  const rule = MODULE_ACCESS[module];
  if (!rule.readRestricted) return true; // 前台共用读：任何已登录用户放行
  return rule.write.includes(role as UserRole) || (rule.read ?? []).includes(role as UserRole);
}

// ============================================================
// 电源域（角色 × 域）授权 —— 2026-10-17 第五轮「开关域划分」
// ------------------------------------------------------------
// 三层结构：域 Domain（可授权/可增删，展厅/园区/新楼栋）
//          > 楼层 floor（域内位置 1F/2F/音响/园区）
//          > 回路 circuit（具体开关）。
// 目标：不同角色只能操作所属域内开关，根治跨区误触全场断电/静音。
// 域清单（power_domain 表）可后台增删；下面这张角色×域矩阵写在代码里，
// 保证授权不被后台误改，且**新域默认只归 admin**（最小权限）。
// ============================================================

export const POWER_DOMAIN = {
  HALL: 'hall',
  PARK: 'park',
} as const;

/**
 * 各角色可「写」（单路通断 / 后台手动测试）的电源域。admin 与 hardware 全域全通，
 * 无需列出（hardware 是全域技术排障角色，未来新增楼栋也应可操作）。
 *  - config   仅园区（4G 自动开关的定时 + 手动测试），展厅 LED 总闸不归他；
 *  - operator 仅展厅（播放页/电源页单路）；
 *  - viewer   不在此表 → 无任何写域。
 * 新域默认对 config/operator/viewer 不开放（最小权限）。
 */
const POWER_DOMAIN_WRITE_ROLES: Partial<Record<UserRole, string[]>> = {
  config: [POWER_DOMAIN.PARK],
  operator: [POWER_DOMAIN.HALL],
};

/**
 * 各角色可「读」（列表 / 状态 / 详情）的电源域，即数据范围。
 * admin/hardware 全域（含未来新域）；config 只读园区；operator/viewer 只读展厅。
 */
const POWER_DOMAIN_READ_ROLES: Partial<Record<UserRole, string[]>> = {
  config: [POWER_DOMAIN.PARK],
  operator: [POWER_DOMAIN.HALL],
  viewer: [POWER_DOMAIN.HALL],
};

/** 全域角色（后台排障/管理员）：所有域（含未来新增）都可读写。 */
const POWER_DOMAIN_UNRESTRICTED_ROLES: UserRole[] = ['admin', 'hardware'];

/** 角色是否可写某个电源域（admin/hardware 全通；无角色/未知域/未知角色默认拒绝）。 */
export function canWritePowerDomain(role: string | undefined, domainCode: string | undefined): boolean {
  if (!role || !domainCode) return false;
  if (POWER_DOMAIN_UNRESTRICTED_ROLES.includes(role as UserRole)) return true;
  return POWER_DOMAIN_WRITE_ROLES[role as UserRole]?.includes(domainCode) ?? false;
}

/**
 * 角色可见（读）的电源域集合（数据范围）：
 *  - 返回 null = 全域可见（admin/hardware，或内部/无 actor 的系统调用）；
 *  - 返回数组 = 仅这些域可见（新域若不在数组内，非全域角色自动不可见）。
 */
export function readablePowerDomains(role: string | undefined): string[] | null {
  if (!role) return null;
  if (POWER_DOMAIN_UNRESTRICTED_ROLES.includes(role as UserRole)) return null;
  return POWER_DOMAIN_READ_ROLES[role as UserRole] ?? [];
}
