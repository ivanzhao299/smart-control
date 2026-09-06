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

  @Post()
  async create(@Body() dto: CreateUserDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.create(dto, requireAdmin(req).username);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.update(id, dto, requireAdmin(req).username);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    await this.service.remove(id, requireAdmin(req).username);
    return { message: '删除成功', data: null };
  }
}
