import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../entities/user.entity';

/**
 * 前台「设备实体控制」写角色白名单 key。配合 WriteRoleGuard 使用。
 *
 * 与后台分域 @ModuleAccess 的区别：
 * - @ModuleAccess 用于后台页面分域（走 rbac.ts 矩阵）。
 * - @WriteRoles 用于前台 PWA 的设备实体控制（音响/灯光/LED/电源/投影/道闸等），
 *   这些端点不归属后台模块，直接声明允许的角色；GET/HEAD/OPTIONS 一律放行。
 *
 *   @UseGuards(RateLimitGuard, WriteRoleGuard)
 *   @WriteRoles('admin')          // 仅管理员可写
 *   @Controller('audio')
 *
 * 方法级可覆盖类级声明，例如电源回路的 on/off 额外放行 hardware：
 *   @Post(':id/on')
 *   @UseGuards(RateLimitGuard, WriteRoleGuard)
 *   @WriteRoles('admin', 'hardware')
 */
export const WRITE_ROLES_KEY = 'required_write_roles';

/** 声明该路由（或控制器）写方法允许的用户角色（满足其一即可）。读方法不受限。 */
export const WriteRoles = (...roles: UserRole[]) => SetMetadata(WRITE_ROLES_KEY, roles);
