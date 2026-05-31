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
  UseGuards,
} from '@nestjs/common';
import { LightZonesService, type LightZoneUpsertDto } from './light-zones.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';

/**
 * 灯光分区 CRUD.
 *
 * 读: GET / GET/:id — 不要 token, LightingPage 拉这个渲染
 * 写: POST / PUT / DELETE — 后台编辑, 需要 admin token
 */
@Controller('light-zones')
export class LightZonesController {
  constructor(private readonly service: LightZonesService) {}

  @Get()
  async list(@Query('includeDisabled') includeDisabled?: string) {
    const include = includeDisabled === '1' || includeDisabled === 'true';
    return {
      message: '查询成功',
      data: await this.service.list({ includeDisabled: include }),
    };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.detail(id) };
  }

  @Post()
  @UseGuards(AdminGuard)
  async create(@Body() dto: LightZoneUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<LightZoneUpsertDto>,
  ) {
    return { message: '更新成功', data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }
}
