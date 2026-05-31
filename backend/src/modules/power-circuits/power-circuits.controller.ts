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
import {
  PowerCircuitsService,
  type PowerCircuitUpsertDto,
} from './power-circuits.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';

/**
 * 电源回路 CRUD + 通断.
 *
 * 读 (list/detail): 不要 token, 业主前台 PowerPage 拉这个 (含实时电流/电压/功率/电量)
 * 写 (create/update/delete): 后台 admin
 * 通断 (on/off): RateLimit 限速 (跟 lighting 一样, 防双击)
 */
@Controller('power-circuits')
export class PowerCircuitsController {
  constructor(private readonly service: PowerCircuitsService) {}

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
  async create(@Body() dto: PowerCircuitUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<PowerCircuitUpsertDto>,
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

  // ============ 通断 (限速) ============

  @Post(':id/on')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 4, windowMs: 1000 })
  async on(@Param('id', ParseIntPipe) id: number) {
    return { message: '通电成功', data: await this.service.turnOn(id) };
  }

  @Post(':id/off')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 4, windowMs: 1000 })
  async off(@Param('id', ParseIntPipe) id: number) {
    return { message: '断电成功', data: await this.service.turnOff(id) };
  }
}
