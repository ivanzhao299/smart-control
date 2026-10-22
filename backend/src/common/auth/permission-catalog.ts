/**
 * 原子权限点目录（动态 RBAC 唯一事实源）。
 *
 * 设计要点（见《动态角色与原子权限 RBAC 规划报告》第 6 章）：
 * - 粒度按「业务动作」而非 418 个端点逐一提权：同一类业务动作（如多个 LED 控制端点）
 *   共用一个权限点，管理员在后台按业务理解勾选，不过细也不致过粗。
 * - code 形如 `资源:动作`（如 energy:export）；全局唯一、小写英文、稳定不变。
 * - 功能权限（本文件）与行级权限（power_domain_role_grant 电源域）正交：
 *   有 power:switch 只代表「能操作开关」，能操作哪个区域由行级域授权决定。
 * - admin 恒为全权限（代码锁定，不入库、不可改），故不出现在 BUILTIN_ROLE_PERMISSIONS。
 * - 本目录由 PermissionService 在启动时 upsert 投影到 permission 表；新增权限点只改这里，
 *   迁移与运行时都会自动补齐，无需手工改库。
 *
 * 内置角色的默认权限集与迁移前的硬编码矩阵（rbac.ts + 各 controller 装饰器 +
 * 前端路由清单）逐条对齐，保证上线当天零行为变化。
 */

export type PermissionKind = 'view' | 'write' | 'admin';
export type PermissionScope = 'front' | 'back' | 'both';
export type PermissionGroupCode =
  | 'front-play'
  | 'media'
  | 'devices'
  | 'energy'
  | 'backend'
  | 'system';

export interface PermissionGroupDef {
  code: PermissionGroupCode;
  /** 分组中文名（后台勾选树的分组标题）。 */
  name: string;
  sort: number;
}

export interface PermissionDef {
  /** 权限点 code，全局唯一，形如 `资源:动作`。 */
  code: string;
  /** 中文名（后台勾选树逐项展示）。 */
  name: string;
  /** 所属分组。 */
  group: PermissionGroupCode;
  /** view=只读查看；write=操作/管理（含导出、触发设备）；admin=系统级，默认仅超管。 */
  kind: PermissionKind;
  /** front=PWA 前台；back=后台；both=两端皆可能。 */
  scope: PermissionScope;
  /** 组内排序。 */
  sort: number;
  /** 备注（可选，说明边界/与行级权限关系）。 */
  hint?: string;
}

export const PERMISSION_GROUPS: readonly PermissionGroupDef[] = [
  { code: 'front-play', name: '前台首页与播控', sort: 10 },
  { code: 'media', name: '媒体库', sort: 20 },
  { code: 'devices', name: '设备控制（前台实体）', sort: 30 },
  { code: 'energy', name: '能源水电', sort: 40 },
  { code: 'backend', name: '后台运行与配置', sort: 50 },
  { code: 'system', name: '系统管理', sort: 60 },
];

/**
 * 原子权限点清单（约 50 个）。顺序即后台勾选树内的展示顺序。
 */
export const PERMISSION_CATALOG: readonly PermissionDef[] = [
  // ===== A. 前台首页与播控 =====
  { code: 'dashboard:view', name: '首页 / 场景列表查看', group: 'front-play', kind: 'view', scope: 'front', sort: 10 },
  { code: 'scene:execute', name: '执行场景（一键播控）', group: 'front-play', kind: 'write', scope: 'front', sort: 20 },
  { code: 'led:view', name: 'LED 大屏状态查看', group: 'front-play', kind: 'view', scope: 'front', sort: 30 },
  { code: 'led:control', name: 'LED 大屏播控（开关/切源/播放）', group: 'front-play', kind: 'write', scope: 'front', sort: 40 },
  { code: 'led-program:view', name: 'LED 节目制作（编排/查看/历史）', group: 'front-play', kind: 'view', scope: 'front', sort: 41 },
  { code: 'led-program:control', name: 'LED 节目制作（生成 bin / 推流）', group: 'front-play', kind: 'write', scope: 'front', sort: 42 },
  { code: 'projector:view', name: '投影仪状态查看', group: 'front-play', kind: 'view', scope: 'front', sort: 50 },
  { code: 'projector:control', name: '投影仪播控（开关/切源/播放）', group: 'front-play', kind: 'write', scope: 'front', sort: 60 },
  { code: 'welcome:edit', name: '欢迎页内容编辑', group: 'front-play', kind: 'write', scope: 'front', sort: 70 },
  { code: 'status:view', name: '系统状态总览', group: 'front-play', kind: 'view', scope: 'front', sort: 80 },

  // ===== B. 媒体库 =====
  { code: 'media:view', name: '媒体库查看', group: 'media', kind: 'view', scope: 'front', sort: 10 },
  { code: 'media:upload', name: '上传媒体', group: 'media', kind: 'write', scope: 'front', sort: 20 },
  { code: 'media:rename', name: '媒体改名 / 编辑', group: 'media', kind: 'write', scope: 'front', sort: 30 },
  { code: 'media:delete', name: '删除媒体', group: 'media', kind: 'write', scope: 'front', sort: 40 },

  // ===== C. 设备控制（前台实体） =====
  { code: 'lighting:view', name: '灯光查看', group: 'devices', kind: 'view', scope: 'front', sort: 10 },
  { code: 'lighting:control', name: '灯光控制', group: 'devices', kind: 'write', scope: 'front', sort: 11 },
  { code: 'audio:view', name: '音响查看', group: 'devices', kind: 'view', scope: 'front', sort: 20 },
  { code: 'audio:control', name: '音响控制', group: 'devices', kind: 'write', scope: 'front', sort: 21 },
  { code: 'hvac:view', name: '空调查看', group: 'devices', kind: 'view', scope: 'front', sort: 30 },
  { code: 'hvac:control', name: '空调控制', group: 'devices', kind: 'write', scope: 'front', sort: 31 },
  { code: 'power:view', name: '电源回路查看', group: 'devices', kind: 'view', scope: 'front', sort: 40 },
  {
    code: 'power:switch', name: '电源回路通断（单路开关）', group: 'devices', kind: 'write', scope: 'front', sort: 41,
    hint: '仅决定能否操作开关；可操作哪个区域由「电源区域授权」（行级）决定。',
  },
  { code: 'power:manage', name: '时序器批量 / 楼层 / 改名 / 整馆通断', group: 'devices', kind: 'write', scope: 'front', sort: 42 },
  { code: 'dali:control', name: 'DALI 灯光控制', group: 'devices', kind: 'write', scope: 'front', sort: 50 },
  { code: 'dali:diagnose', name: 'DALI 诊断', group: 'devices', kind: 'write', scope: 'front', sort: 51 },
  { code: 'barrier:view', name: '道闸查看', group: 'devices', kind: 'view', scope: 'front', sort: 60 },
  { code: 'barrier:control', name: '道闸开关', group: 'devices', kind: 'write', scope: 'front', sort: 61 },

  // ===== D. 能源水电（前台新增；物业首个应用） =====
  { code: 'energy:view', name: '水电总览（树 / 在线率）', group: 'energy', kind: 'view', scope: 'front', sort: 10 },
  { code: 'energy:detail', name: '逐表 / 楼栋明细、欠费与缴费流水', group: 'energy', kind: 'view', scope: 'front', sort: 20 },
  { code: 'energy:export', name: '导出水电报表（Excel）', group: 'energy', kind: 'write', scope: 'front', sort: 30 },
  { code: 'energy:readout', name: '远程召测 / 抄表（触发平台抄表）', group: 'energy', kind: 'write', scope: 'front', sort: 40 },
  {
    code: 'energy:rename', name: '住房/业主改名、电表档案维护', group: 'energy', kind: 'write', scope: 'front', sort: 45,
    hint: '客户名称、业主户名/电话、绑定住房与表档案维护；前后值留痕，不涉及资金。',
  },
  {
    code: 'energy:recharge', name: '现金 / 补量录入（收银充值）', group: 'energy', kind: 'write', scope: 'front', sort: 46,
    hint: '物业收银台人工现金 / 补量充值；金额校验、二次确认、操作人与前后余额留痕，按日对账。',
  },
  {
    code: 'energy:refund', name: '退费 / 减免', group: 'energy', kind: 'write', scope: 'front', sort: 47,
    hint: '仅成功缴费单可退；金额与原因留痕，按日对账。与现金录入分开授权（退费风险更高）。',
  },
  {
    code: 'energy:control', name: '远程拉合闸 / 校时 / 多费率（高危）', group: 'energy', kind: 'write', scope: 'front', sort: 48,
    hint: '直接改变现场供电：默认仅管理员，须输入户名+原因二次确认并完整留痕；不授任何普通角色。',
  },
  { code: 'energy:ledger', name: '水电台账 / 变压器配置（后台）', group: 'energy', kind: 'admin', scope: 'back', sort: 50 },

  // ===== E. 后台运行与配置 =====
  { code: 'monitor:view', name: '运维监控（运行态势只读）', group: 'backend', kind: 'view', scope: 'back', sort: 10 },
  { code: 'monitor:diagnose', name: '运维诊断（清除网关故障 / 手动健康探测）', group: 'backend', kind: 'write', scope: 'back', sort: 11 },
  { code: 'alerts:manage', name: '报警中心管理', group: 'backend', kind: 'write', scope: 'back', sort: 20 },
  { code: 'scenes:manage', name: '后台场景与场景动作管理', group: 'backend', kind: 'write', scope: 'back', sort: 30 },
  { code: 'scheduler:manage', name: '定时任务管理', group: 'backend', kind: 'write', scope: 'back', sort: 40 },
  { code: 'metrics:view', name: '运营数据查看', group: 'backend', kind: 'view', scope: 'back', sort: 50 },
  { code: 'power-timing:manage', name: '自动开关 / 4G 定时通断', group: 'backend', kind: 'write', scope: 'back', sort: 60 },
  { code: 'devices:manage', name: '设备管理', group: 'backend', kind: 'write', scope: 'back', sort: 70 },
  { code: 'hardware:manage', name: '硬件 / 驱动 / 品牌管理', group: 'backend', kind: 'write', scope: 'back', sort: 80 },
  { code: 'zones:manage', name: '分区配置（灯光/电源/音频分区）', group: 'backend', kind: 'write', scope: 'back', sort: 90 },
  { code: 'video:manage', name: '视频绑定 / 道闸配置', group: 'backend', kind: 'write', scope: 'back', sort: 100 },
  { code: 'lpr:manage', name: '车牌道闸管理', group: 'backend', kind: 'write', scope: 'back', sort: 110 },
  { code: 'diagnostics:view', name: '日志中心 / 审计查看', group: 'backend', kind: 'view', scope: 'back', sort: 120 },
  { code: 'uat:access', name: '测试 / 调试 / UAT 验收', group: 'backend', kind: 'write', scope: 'back', sort: 130 },
  { code: 'branding:manage', name: '系统品牌 / 欢迎页品牌管理', group: 'backend', kind: 'write', scope: 'back', sort: 140 },
  { code: 'app-release:view', name: 'APP 版本查看 / 下载 APK', group: 'backend', kind: 'view', scope: 'back', sort: 150 },
  { code: 'app-release:manage', name: 'APP 发布管理（启停/强制更新）', group: 'backend', kind: 'write', scope: 'back', sort: 151 },
  { code: 'system:settings', name: '系统设置', group: 'backend', kind: 'admin', scope: 'back', sort: 160 },

  // ===== F. 系统管理 =====
  { code: 'user:manage', name: '用户管理（增删改 / 启停 / 重置密码）', group: 'system', kind: 'admin', scope: 'back', sort: 10 },
  { code: 'role:manage', name: '角色与权限管理（新建角色 / 勾选权限）', group: 'system', kind: 'admin', scope: 'back', sort: 20 },
];

/** 全部权限点 code（启动投影与校验用）。 */
export const ALL_PERMISSION_CODES: readonly string[] = PERMISSION_CATALOG.map((p) => p.code);

const PERMISSION_CODE_SET = new Set<string>(ALL_PERMISSION_CODES);

/** 判断 code 是否为系统登记的合法权限点。 */
export function isKnownPermission(code: string): boolean {
  return PERMISSION_CODE_SET.has(code);
}

/**
 * 内置角色元数据（迁移种子与启动投影的唯一来源）。
 *
 * - admin 为锁定超管：权限恒为全集、不可删 / 不可停用 / 不可改权限（防止自锁）。
 * - canFront / canBack：该角色是否可登录 PWA 前台 / 后台。
 */
export interface BuiltinRoleDef {
  code: string;
  name: string;
  description: string;
  canFront: boolean;
  canBack: boolean;
  sort: number;
  /** 锁定角色：权限恒全（admin），不入库 role_permission、不允许改。 */
  lockedFull?: boolean;
}

export const BUILTIN_ROLES: readonly BuiltinRoleDef[] = [
  {
    code: 'admin', name: '管理员', description: '超级管理员，系统全部功能与配置（含用户/角色、系统设置、发版、审计）。',
    canFront: true, canBack: true, sort: 10, lockedFull: true,
  },
  {
    code: 'hardware', name: '硬件工程师', description: '前台电源全域通断；后台运维监控只读、自动开关/定时通断。',
    canFront: true, canBack: true, sort: 20,
  },
  {
    code: 'config', name: '运营配置员', description: '前台园区电源与欢迎页编辑；后台仅自动开关/定时通断。',
    canFront: true, canBack: true, sort: 30,
  },
  {
    code: 'operator', name: '展厅操作员', description: '前台首页/LED/投影播控、媒体上传改名、展厅电源；后台仅下载 APK 与改密码。',
    canFront: true, canBack: true, sort: 40,
  },
  {
    code: 'viewer', name: '只读账户', description: '仅前台只读查看，无任何操作/控制，不能登录后台。',
    canFront: true, canBack: false, sort: 50,
  },
];

/** 锁定为全权限的角色 code（admin）。 */
export const FULL_ACCESS_ROLES: readonly string[] = BUILTIN_ROLES.filter((r) => r.lockedFull).map((r) => r.code);

export function isFullAccessRole(code: string | undefined | null): boolean {
  return !!code && FULL_ACCESS_ROLES.includes(code);
}

/** 内置角色 code 集合（保留，便于替代旧 USER_ROLES 枚举的场景）。 */
export const BUILTIN_ROLE_CODES: readonly string[] = BUILTIN_ROLES.map((r) => r.code);

/**
 * 内置角色 → 默认权限点（与迁移前硬编码矩阵逐条对齐，保证零行为变化）。
 * admin 不出现：锁定全权限，由 isFullAccessRole 直接放行。
 */
export const BUILTIN_ROLE_PERMISSIONS: Record<string, string[]> = {
  // 硬件工程师：前台电源全域通断 + 后台运维监控只读/诊断 + 自动开关/定时通断。
  hardware: [
    'power:view',
    'power:switch',
    'monitor:view',
    'monitor:diagnose',
    'power-timing:manage',
  ],
  // 运营配置员：前台园区电源（行级限定园区）+ 欢迎页编辑 + LED 节目制作（编排/生成 bin）+ 后台自动开关。
  config: [
    'power:view',
    'power:switch',
    'welcome:edit',
    'led:view',
    'power-timing:manage',
  ],
  // 展厅操作员：前台首页/场景执行 + LED/投影播控 + 媒体查看上传改名 + 展厅电源（行级限定展厅）
  // + 欢迎页编辑；后台仅 APP 版本只读下载 APK（改密码是所有登录账户的自助能力，不占权限点）。
  operator: [
    'dashboard:view',
    'scene:execute',
    'led:view',
    'led:control',
    'projector:view',
    'projector:control',
    'welcome:edit',
    'media:view',
    'media:upload',
    'media:rename',
    'power:view',
    'power:switch',
    'app-release:view',
  ],
  // 只读账户：前台各只读页查看，无任何写/控制，不进后台。
  viewer: [
    'dashboard:view',
    'led:view',
    'projector:view',
    'lighting:view',
    'audio:view',
    'hvac:view',
    'power:view',
    'media:view',
    'barrier:view',
  ],
};

/** 内置角色中文名（无映射时回退 code 本身）。 */
const BUILTIN_ROLE_NAME_MAP: Record<string, string> = Object.fromEntries(
  BUILTIN_ROLES.map((r) => [r.code, r.name]),
);

export function builtinRoleName(code: string): string {
  return BUILTIN_ROLE_NAME_MAP[code] ?? code;
}

/** 取得某角色的「静态默认权限集」（不含运行时 DB 自定义；admin 返回全集）。 */
export function defaultPermissionsForRole(code: string): string[] {
  if (isFullAccessRole(code)) return [...ALL_PERMISSION_CODES];
  return [...(BUILTIN_ROLE_PERMISSIONS[code] ?? [])];
}
