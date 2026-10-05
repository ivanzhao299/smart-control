import { SetMetadata } from '@nestjs/common';
import type { UserRole } from '../../entities/user.entity';

/**
 * 角色白名单元数据 key。配合 RolesGuard 使用：
 *
 *   @UseGuards(RolesGuard)
 *   @Roles('admin', 'operator')
 *   @Put('something')
 *
 * 只有 req.actor.role 命中白名单的身份可通过；未标注 @Roles 的路由不受限制。
 */
export const ROLES_KEY = 'required_roles';

/** 声明该路由允许的用户角色（满足其一即可）。 */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
