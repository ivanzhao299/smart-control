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
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { WriteRoleGuard } from '../../common/guards/write-role.guard';
import { WriteRoles } from '../../common/decorators/write-roles.decorator';

/**
 * 电源回路 CRUD + 通断.
 *
 * 读 (list/detail): 不要 token, 业主前台 PowerPage 拉这个 (含实时电流/电压/功率/电量)
 * 写 (create/update/delete/rename): 后台 zones 模块（2026-10-16 起仅 admin）
 * 通断 (on/off): admin + hardware（设备管理员在「自动开关」页手动合闸/分闸测试），限速防双击
 * 时序器全开/全关 (sequencer): 仅 admin（批量上下电，高风险）
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

  // ============ 时序器 (EPO-802P) ============
  // ⚠️ 路由顺序: 'sequencer/*' 必须声明在 ':id' 参数路由之前, 否则被 ParseIntPipe 吃掉 400。

  /** 时序开机 (b3 全开) — 设备按各路延时 1,3,..15s 依次上电, 保护功放；仅 admin */
  @Post('sequencer/all-on')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin')
  @RateLimit({ max: 2, windowMs: 3000 })
  async seqAllOn() {
    await this.service.sequencerAll(true);
    return { message: '时序开机已下发, 各路按延时依次上电', data: { on: true } };
  }

  /** 时序关机 (b3 全关) — 先开的后关, 按 15,13,..1s 依次断电；仅 admin */
  @Post('sequencer/all-off')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin')
  @RateLimit({ max: 2, windowMs: 3000 })
  async seqAllOff() {
    await this.service.sequencerAll(false);
    return { message: '时序关机已下发, 各路按延时依次断电', data: { on: false } };
  }

  /** 改名影响所有用户的共享配置，仅管理员；on/off仍为日常控制。 */
  @Post(':id/rename')
  @UseGuards(ModuleAccessGuard, RateLimitGuard)
  @ModuleAccess('zones')
  @RateLimit({ max: 4, windowMs: 1000 })
  async rename(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string } = {}) {
    return { message: '已改名', data: await this.service.rename(id, body.name ?? '') };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.detail(id) };
  }

  /** 智能断路器全量计量: 三相分相电压/电流 + 漏电 + 4 路接线柱温度 + 报警位 */
  @Get(':id/breaker')
  async breaker(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.breakerMeasurements(id) };
  }

  @Post()
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async create(@Body() dto: PowerCircuitUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<PowerCircuitUpsertDto>,
  ) {
    return { message: '更新成功', data: await this.service.update(id, dto) };
  }

  @Delete(':id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }

  // ============ 通断 (限速) ============

  @Post(':id/on')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin', 'hardware')
  @RateLimit({ max: 4, windowMs: 1000 })
  async on(@Param('id', ParseIntPipe) id: number) {
    return { message: '通电成功', data: await this.service.turnOn(id) };
  }

  @Post(':id/off')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin', 'hardware')
  @RateLimit({ max: 4, windowMs: 1000 })
  async off(@Param('id', ParseIntPipe) id: number) {
    return { message: '断电成功', data: await this.service.turnOff(id) };
  }
}
