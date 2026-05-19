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
import { ScenesService } from './scenes.service';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';
import { SceneEngineService } from '../../services/scene-engine.service';

@Controller('scenes')
export class ScenesController {
  constructor(
    private readonly service: ScenesService,
    private readonly engine: SceneEngineService,
  ) {}

  @Get()
  async list(@Query() query: QuerySceneDto) {
    const data = await this.service.findAll(query);
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  @Post()
  async create(@Body() dto: CreateSceneDto) {
    const data = await this.service.create(dto);
    return { message: '创建成功', data };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSceneDto) {
    const data = await this.service.update(id, dto);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }

  @Post(':code/execute')
  @HttpCode(202)
  async execute(@Param('code') code: string) {
    const data = await this.engine.execute(code);
    return { message: '场景已开始执行', data };
  }

  @Post(':code/stop')
  @HttpCode(200)
  async stop(@Param('code') code: string) {
    const data = await this.engine.stop(code);
    return { message: '场景已请求停止', data };
  }

  @Post(':code/cancel')
  @HttpCode(200)
  async cancel(@Param('code') code: string) {
    const data = await this.engine.cancel(code);
    return { message: '场景已取消', data };
  }

  /**
   * Sprint-03 spec Task-010: 测试执行场景
   * 与正式 execute 共享 SceneEngine, 但 triggerType=system / triggerSource=test
   * MOCK_MODE=true 时不影响真实设备 (mock adapter)
   */
  @Post(':code/test')
  @HttpCode(202)
  async testExecute(@Param('code') code: string) {
    const data = await this.engine.execute(code, 'test', {
      triggerType: 'system',
      triggerSource: 'test',
    });
    return { message: '场景已开始测试执行', data };
  }

  @Get('runtime/running')
  async running() {
    const data = this.engine.listRunning();
    return { message: '查询成功', data };
  }

  @Get('runtime/queued')
  async queued() {
    const data = this.engine.listQueued();
    return { message: '查询成功', data };
  }
}
