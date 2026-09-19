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
import { ScenesService } from './scenes.service';
import { UseGuards } from '@nestjs/common';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { WriteRoleGuard } from '../../common/guards/write-role.guard';
import { WriteRoles } from '../../common/decorators/write-roles.decorator';
import { CreateSceneDto } from './dto/create-scene.dto';
import { UpdateSceneDto } from './dto/update-scene.dto';
import { QuerySceneDto } from './dto/query-scene.dto';
import { SceneEngineService } from '../../services/scene-engine.service';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';

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
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('scenes')
  async create(@Body() dto: CreateSceneDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.create(dto, requireActor(req).username);
    return { message: '创建成功', data };
  }

  @Put(':id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('scenes')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSceneDto, @Req() req: AuthenticatedRequest) {
    const data = await this.service.update(id, dto, requireActor(req).username);
    return { message: '更新成功', data };
  }

  @Delete(':id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('scenes')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number, @Query('expectedRevision', ParseIntPipe) expectedRevision: number, @Req() req: AuthenticatedRequest) {
    await this.service.remove(id, expectedRevision, requireAdmin(req).username);
    return { message: '删除成功', data: null };
  }

  // 前台首页场景键执行/停止/取消：展厅操作员的保留项，限 admin/operator；
  // hardware/config 不播控。后台「测试执行」走下方 :code/test（ModuleAccess('scenes')）。
  @Post(':code/execute')
  @UseGuards(WriteRoleGuard)
  @WriteRoles('admin', 'operator')
  @HttpCode(202)
  async execute(@Param('code') code: string) {
    const data = await this.engine.execute(code);
    return { message: '场景已开始执行', data };
  }

  @Post(':code/stop')
  @UseGuards(WriteRoleGuard)
  @WriteRoles('admin', 'operator')
  @HttpCode(200)
  async stop(@Param('code') code: string) {
    const data = await this.engine.stop(code);
    return { message: '场景已请求停止', data };
  }

  @Post(':code/cancel')
  @UseGuards(WriteRoleGuard)
  @WriteRoles('admin', 'operator')
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
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('scenes')
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
