import { SetMetadata } from '@nestjs/common';
import type { AdminModule } from '../auth/rbac';

/** 分域访问元数据 key。配合 ModuleAccessGuard 使用。 */
export const MODULE_ACCESS_KEY = 'required_module_access';

/**
 * 声明该路由（或整个控制器）归属的后台分域。ModuleAccessGuard 依据 common/auth/rbac.ts
 * 的矩阵判断：GET 按读规则、写方法（POST/PUT/PATCH/DELETE）按可写角色放行。
 *
 *   @UseGuards(ModuleAccessGuard)
 *   @ModuleAccess('devices')
 *   @Controller('devices')
 */
export const ModuleAccess = (module: AdminModule) => SetMetadata(MODULE_ACCESS_KEY, module);
