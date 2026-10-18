import {
  ALL_PERMISSION_CODES,
  BUILTIN_ROLES,
  BUILTIN_ROLE_PERMISSIONS,
  BUILTIN_ROLE_CODES,
  PERMISSION_CATALOG,
  PERMISSION_GROUPS,
  defaultPermissionsForRole,
  isFullAccessRole,
  isKnownPermission,
} from './permission-catalog';

describe('permission-catalog 原子权限点目录', () => {
  it('权限点 code 全局唯一', () => {
    const codes = PERMISSION_CATALOG.map((p) => p.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('每个权限点都归属一个已登记的分组，且组内 sort 唯一', () => {
    const groupCodes = new Set(PERMISSION_GROUPS.map((g) => g.code));
    for (const p of PERMISSION_CATALOG) {
      expect(groupCodes.has(p.group)).toBe(true);
    }
    for (const g of PERMISSION_GROUPS) {
      const sorts = PERMISSION_CATALOG.filter((p) => p.group === g.code).map((p) => p.sort);
      expect(new Set(sorts).size).toBe(sorts.length);
    }
  });

  it('权限点数量落在按业务动作划分的预期规模（约 50 个，非逐端点 418）', () => {
    expect(PERMISSION_CATALOG.length).toBeGreaterThanOrEqual(40);
    expect(PERMISSION_CATALOG.length).toBeLessThanOrEqual(80);
  });

  it('内置角色元数据完整：code 唯一、可登录方向至少一个为真', () => {
    const codes = BUILTIN_ROLES.map((r) => r.code);
    expect(new Set(codes).size).toBe(codes.length);
    expect(BUILTIN_ROLE_CODES).toEqual(codes);
    for (const r of BUILTIN_ROLES) {
      expect(r.name).toBeTruthy();
      expect(r.canFront || r.canBack).toBe(true);
    }
  });

  it('内置角色默认权限集引用的 code 全部合法', () => {
    for (const [role, perms] of Object.entries(BUILTIN_ROLE_PERMISSIONS)) {
      for (const code of perms) {
        expect(isKnownPermission(code)).toBe(true);
      }
      // 同一角色内不应有重复权限点。
      expect(new Set(perms).size).toBe(perms.length);
    }
  });

  it('admin 锁定全权限，不写入显式默认集，且默认集即全集', () => {
    expect(isFullAccessRole('admin')).toBe(true);
    expect(BUILTIN_ROLE_PERMISSIONS.admin).toBeUndefined();
    expect(defaultPermissionsForRole('admin').sort()).toEqual([...ALL_PERMISSION_CODES].sort());
  });

  it('viewer 只读：默认集不含任何 write/admin 权限点，且不能进后台', () => {
    const viewer = BUILTIN_ROLES.find((r) => r.code === 'viewer')!;
    expect(viewer.canBack).toBe(false);
    const byCode = new Map(PERMISSION_CATALOG.map((p) => [p.code, p]));
    for (const code of BUILTIN_ROLE_PERMISSIONS.viewer) {
      expect(byCode.get(code)!.kind).toBe('view');
    }
  });

  it('operator 后台只有 app-release:view（下载 APK），无任何系统/后台管理写权限', () => {
    const backPerms = BUILTIN_ROLE_PERMISSIONS.operator.filter((code) => {
      const def = PERMISSION_CATALOG.find((p) => p.code === code)!;
      return def.scope === 'back';
    });
    expect(backPerms).toEqual(['app-release:view']);
  });
});
