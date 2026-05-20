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
} from '@nestjs/common';
import { HardwareService } from './hardware.service';
import { CreateHardwareDto, QueryHardwareDto, UpdateHardwareDto } from './dto/hardware.dto';

@Controller('hardware')
export class HardwareController {
  constructor(private readonly service: HardwareService) {}

  @Get()
  async list(@Query() q: QueryHardwareDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get('summary')
  async summary() {
    const data = await this.service.summary();
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  @Post()
  async create(@Body() dto: CreateHardwareDto) {
    const data = await this.service.create(dto);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateHardwareDto) {
    const data = await this.service.update(id, dto);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }
}
