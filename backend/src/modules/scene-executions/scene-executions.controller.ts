import { Controller, Get, Param, ParseIntPipe, Query } from '@nestjs/common';
import { SceneExecutionsService } from './scene-executions.service';
import { QueryExecutionDto } from './dto/query-execution.dto';

@Controller('scene-executions')
export class SceneExecutionsController {
  constructor(private readonly service: SceneExecutionsService) {}

  @Get()
  async list(@Query() q: QueryExecutionDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }
}
