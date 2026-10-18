import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { PermissionService } from './permission.service';
import {
  CopyRoleDto,
  CreateRoleDto,
  GrantPermissionsDto,
  UpdateRoleDto,
} from './dto/role.dto';

/**
 * 角色与权限管理（动态 RBAC），仅管理员（role:manage）。
 * 控制器整体用 ActorAdminGuard 锁 admin；逐端点的细粒度权限点留给后续权限体系自身演进。
 */
@Controller('roles')
@UseGuards(ActorAdminGuard)
export class RolesController {
  constructor(private readonly permissions: PermissionService) {}

  private operator(req: AuthenticatedRequest): string {
    return requireActor(req).username || 'admin';
  }

  /** 权限点目录（分组树，后台勾选树用）。 */
  @Get('permissions')
  catalog() {
    return { message: 'ok', data: this.permissions.getCatalog() };
  }

  /** 角色列表（含用户数、权限数、登录方向、启用态）。 */
  @Get()
  async list() {
    return { message: 'ok', data: await this.permissions.listRoles() };
  }

  /** 角色详情（含权限 code 列表）。 */
  @Get(':code')
  async detail(@Param('code') code: string) {
    return { message: 'ok', data: await this.permissions.getRole(code) };
  }

  /** 新建自定义角色（默认停用、零权限）。 */
  @Post()
  async create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoleDto) {
    const data = await this.permissions.createRole(dto, this.operator(req));
    return { message: '角色已创建', data };
  }

  /** 修改角色（名称/描述/登录方向/启用态）。 */
  @Put(':code')
  async update(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() dto: UpdateRoleDto,
  ) {
    const data = await this.permissions.updateRole(code, dto, this.operator(req));
    return { message: '角色已更新', data };
  }

  /** 删除角色（内置不可删；仍有用户使用禁止）。 */
  @Delete(':code')
  @HttpCode(200)
  async remove(@Req() req: AuthenticatedRequest, @Param('code') code: string) {
    await this.permissions.deleteRole(code, this.operator(req));
    return { message: '角色已删除', data: null };
  }

  /** 全量保存角色勾选的权限点。 */
  @Put(':code/permissions')
  async grant(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() dto: GrantPermissionsDto,
  ) {
    const data = await this.permissions.replacePermissions(code, dto.permissions ?? [], this.operator(req));
    return { message: '角色权限已保存', data: { code, permissions: data } };
  }

  /** 复制角色（权限集与登录方向默认取源角色，新角色默认停用）。 */
  @Post(':code/copy')
  async copy(
    @Req() req: AuthenticatedRequest,
    @Param('code') code: string,
    @Body() dto: CopyRoleDto,
  ) {
    const data = await this.permissions.copyRole(code, dto, this.operator(req));
    return { message: '角色已复制', data };
  }
}
