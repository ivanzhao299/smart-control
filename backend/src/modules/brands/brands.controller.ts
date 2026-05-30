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
} from '@nestjs/common';
import { BrandsService, type BrandUpsertDto } from './brands.service';

@Controller('brands')
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
  async create(@Body() dto: BrandUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<BrandUpsertDto>) {
    return { message: '更新成功', data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }
}
