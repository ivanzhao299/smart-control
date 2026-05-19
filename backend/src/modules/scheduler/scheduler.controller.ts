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
import { SchedulerService } from './scheduler.service';
import {
  CreateSchedulerTaskDto,
  QuerySchedulerTaskDto,
  UpdateSchedulerTaskDto,
} from './dto/scheduler.dto';

@Controller('scheduler')
export class SchedulerController {
  constructor(private readonly service: SchedulerService) {}

  @Get()
  async list(@Query() q: QuerySchedulerTaskDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  @Post()
  async create(@Body() dto: CreateSchedulerTaskDto) {
    const data = await this.service.create(dto);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSchedulerTaskDto) {
    const data = await this.service.update(id, dto);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }

  @Post(':id/run')
  @HttpCode(200)
  async runNow(@Param('id', ParseIntPipe) id: number) {
    await this.service.runNow(id);
    return { message: '已触发执行', data: null };
  }
}
