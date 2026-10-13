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
  UseGuards,
} from '@nestjs/common';
import { PowerSchedulesService, PowerScheduleInput } from './power-schedules.service';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';

/**
 * 电源回路自动开关 (定时 + 日落/日出)。
 *
 * 两个后台入口共用同一套规则：
 *  - config 运营配置员：「日常运行 → 自动开关」(energy 模块)
 *  - hardware 硬件工程师：「设备与分区 → 电源回路」(zones 模块)
 * 故写接口用 @ModuleAccess('energy', 'zones') —— 任一模块可写即放行。
 * 业主 PWA 只读展示“下次自动动作”（GET 无守卫）。写操作另加速率限制防误点。
 */
@Controller('power-schedules')
export class PowerSchedulesController {
  constructor(private readonly service: PowerSchedulesService) {}

  @Get()
  async list() {
    return { message: '查询成功', data: await this.service.list() };
  }

  @Get('circuit/:circuitId')
  async listForCircuit(@Param('circuitId', ParseIntPipe) circuitId: number) {
    return { message: '查询成功', data: await this.service.listForCircuit(circuitId) };
  }

  /** 某回路下一次自动动作 (供 PWA 电源页展示) */
  @Get('next/:circuitId')
  async nextRun(@Param('circuitId', ParseIntPipe) circuitId: number) {
    return { message: '查询成功', data: await this.service.nextRun(circuitId) };
  }

  @Post()
  @UseGuards(ModuleAccessGuard, RateLimitGuard)
  @ModuleAccess('energy', 'zones')
  @RateLimit({ max: 10, windowMs: 5000 })
  async create(@Body() dto: PowerScheduleInput) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  @UseGuards(ModuleAccessGuard, RateLimitGuard)
  @ModuleAccess('energy', 'zones')
  @RateLimit({ max: 10, windowMs: 5000 })
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<PowerScheduleInput>) {
    return { message: '更新成功', data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @UseGuards(ModuleAccessGuard, RateLimitGuard)
  @ModuleAccess('energy', 'zones')
  @RateLimit({ max: 10, windowMs: 5000 })
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }
}
