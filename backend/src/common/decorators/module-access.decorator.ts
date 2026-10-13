import { SetMetadata } from '@nestjs/common';
import type { AdminModule } from '../auth/rbac';

/** 分域访问元数据 key。配合 ModuleAccessGuard 使用。 */
export const MODULE_ACCESS_KEY = 'required_module_access';

/**
 * 声明该路由（或整个控制器）归属的后台分域。ModuleAccessGuard 依据 common/auth/rbac.ts
 * 的矩阵判断：GET 按读规则、写方法（POST/PUT/PATCH/DELETE）按可写角色放行。
 *
 * 单模块（最常见，元数据保持为字符串，向后兼容）：
 *   @UseGuards(ModuleAccessGuard)
 *   @ModuleAccess('devices')
 *   @Controller('devices')
 *
 * 跨分域：传入多个模块时，角色对其中「任一」模块可写/可读即放行（OR）。
 * 用于同一实体被两个角色在不同入口共用的情况，例如电源回路自动开关规则：
 * config 在「日常运行→自动开关」(energy)、hardware 在「设备与分区→电源回路」(zones)
 * 都需要配置，故写接口标 @ModuleAccess('energy', 'zones')。
 */
export const ModuleAccess = (...modules: AdminModule[]) =>
  SetMetadata(MODULE_ACCESS_KEY, modules.length === 1 ? modules[0] : modules);
