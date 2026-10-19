import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { AuthenticatedRequest, requireAdmin } from '../../common/auth/actor';
import { UsersService } from './users.service';
import { CreateUserDto, QueryUserDto, UpdateUserDto } from './dto/user.dto';

@Controller('users')
@UseGuards(ActorAdminGuard)
export class UsersController {
  constructor(private readonly service: UsersService) {}

  @Get()
  async list(@Query() q: QueryUserDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  /** 取某用户权限编辑详情（角色基线 + 个人 grant/deny + 最终有效）。 */
  @Get(':id/permissions')
  async userPermissions(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.getUserPermissionDetail(id);
    return { message: '查询成功', data };
  }

  /** 全量替换某用户个人权限覆盖：body { grants: string[], denies: string[] }。 */
  @Put(':id/permissions')
  @HttpCode(200)
  async updateUserPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { grants?: string[]; denies?: string[] },
    @Req() req: AuthenticatedRequest,
  ) {
    const data = await this.service.replaceUserPermissions(
      id,
      Array.isArray(body.grants) ? body.grants : [],
      Array.isArray(body.denies) ? body.denies : [],
      req.actor?.username,
    );
    return { message: '保存成功', data };
  }

  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.create(dto, requireAdmin(req));
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.update(id, dto, requireAdmin(req));
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    await this.service.remove(id, requireAdmin(req));
    return { message: '删除成功', data: null };
  }
}
