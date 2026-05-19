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
import { UatService } from './uat.service';
import {
  CreateUatDto,
  QueryUatDto,
  TransitionUatDto,
  UpdateUatDto,
} from './dto/uat.dto';

@Controller('uat')
export class UatController {
  constructor(private readonly service: UatService) {}

  @Get()
  async list(@Query() q: QueryUatDto) {
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
  async create(@Body() dto: CreateUatDto) {
    const data = await this.service.create(dto);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUatDto) {
    const data = await this.service.update(id, dto);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }

  @Post(':id/pass')
  @HttpCode(200)
  async pass(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionUatDto) {
    const data = await this.service.transition(id, 'passed', dto);
    return { message: '已通过', data };
  }

  @Post(':id/fail')
  @HttpCode(200)
  async fail(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionUatDto) {
    const data = await this.service.transition(id, 'failed', dto);
    return { message: '已标记失败', data };
  }

  @Post(':id/need-adjustment')
  @HttpCode(200)
  async needAdjustment(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: TransitionUatDto,
  ) {
    const data = await this.service.transition(id, 'need_adjustment', dto);
    return { message: '已标记需调整', data };
  }

  @Post(':id/reset')
  @HttpCode(200)
  async reset(@Param('id', ParseIntPipe) id: number, @Body() dto: TransitionUatDto) {
    const data = await this.service.transition(id, 'pending', dto);
    return { message: '已重置', data };
  }
}
