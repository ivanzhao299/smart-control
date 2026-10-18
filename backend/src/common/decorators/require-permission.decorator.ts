import { SetMetadata } from '@nestjs/common';

/**
 * 原子权限点装饰器（动态 RBAC）。
 *
 *   @RequirePermission('energy:export')               // 需拥有单个权限点
 *   @RequirePermission('led:control', 'scene:execute') // 任一满足即放行（OR）
 *
 * 由 PermissionGuard 判定：admin 恒全；其余角色查 RBAC 权限集。
 * 可与 @Public 共存于类级（懒解析 token），与旧 @Roles/@ModuleAccess 可并行过渡。
 */
export const REQUIRE_PERMISSION_KEY = 'require_permission';

export const RequirePermission = (...codes: string[]) =>
  SetMetadata(REQUIRE_PERMISSION_KEY, codes);
