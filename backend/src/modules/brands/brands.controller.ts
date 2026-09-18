import { UseGuards } from '@nestjs/common';
import { ConfigurationWriteGuard } from '../../common/guards/configuration-write.guard';
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
} from '@nestjs/common';
import { BrandsService } from './brands.service';
import { AuthenticatedRequest, requireAdmin } from '../../common/auth/actor';
import {
  CreateBrandConfigDto,
  UpdateBrandConfigDto,
  LegacyUpdateBrandConfigDto,
  BrandRevisionQueryDto,
  LegacyBrandRevisionQueryDto,
} from './brand-config.dto';

@Controller('brands')
@UseGuards(ConfigurationWriteGuard)
export class BrandsController {
  constructor(private readonly service: BrandsService) {}

  @Get()
  async list() {
    return { message: '查询成功', data: await this.service.list() };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.detail(id) };
  }

  @Post()
  async create(@Body() dto: CreateBrandConfigDto, @Req() req: AuthenticatedRequest) {
    return { message: '创建成功', data: await this.service.create(dto, requireAdmin(req)) };
  }

  @Put('editor/:id')
  async updateEditor(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateBrandConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return { message: '更新成功', data: await this.service.update(id, dto, requireAdmin(req)) };
  }

  @Delete('editor/:id')
  @HttpCode(200)
  async removeEditor(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: BrandRevisionQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.service.remove(id, query.expectedRevision, requireAdmin(req));
    return { message: '删除成功', data: null };
  }

  @Put(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: LegacyUpdateBrandConfigDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return { message: '更新成功', data: await this.service.update(id, dto, requireAdmin(req)) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Query() query: LegacyBrandRevisionQueryDto,
    @Req() req: AuthenticatedRequest,
  ) {
    await this.service.remove(id, query.expectedRevision, requireAdmin(req));
    return { message: '删除成功', data: null };
  }
}
