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
import { LightZonesService, type LightZoneUpsertDto } from './light-zones.service';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { LightingAdapter } from '../../adapters/lighting/lighting.adapter';

/**
 * 灯光分区 CRUD.
 *
 * 读: GET / GET/:id — 不要 token, LightingPage 拉这个渲染
 * 写: POST / PUT / DELETE — 后台编辑, 需要 admin token
 */
@Controller('light-zones')
export class LightZonesController {
  constructor(
    private readonly service: LightZonesService,
    private readonly lighting: LightingAdapter,
  ) {}

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
  async create(@Body() dto: LightZoneUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put(':id')
  @UseGuards(AdminGuard)
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<LightZoneUpsertDto>,
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

  /**
   * 后台诊断: 给 zone 发 50% on → 等 1.2s → 0 off.
   * 返回完整路由 (zone, gateway, slaveId, group, mock, durationMs, error).
   * 让用户一眼看到: (1) zone 在哪个网关 (2) 是不是 mock (3) modbus 调用耗时
   * (4) 失败原因.
   *
   * 不走 RateLimitGuard (lighting controller 那个), 因为是后台运维操作, 间隔短没事.
   */
  @Post(':id/test')
  @UseGuards(AdminGuard)
  async test(@Param('id', ParseIntPipe) id: number) {
    const zone = await this.service.detail(id);
    let resolveError: string | null = null;
    let slaveId: number | null = null;
    try {
      const r = await this.service.resolveForCommand(id);
      slaveId = r.slaveId;
    } catch (err) {
      resolveError = (err as Error).message;
    }
    if (resolveError !== null || slaveId === null) {
      return {
        message: '测试失败 — 路由解析阶段',
        data: {
          zone: { id: zone.id, code: zone.code, name: zone.name },
          gateway: { code: zone.gatewayCode, displayName: zone.gatewayDisplayName, slaveId: zone.gatewaySlaveId },
          daliGroup: zone.daliGroup,
          routing: { ok: false, error: resolveError ?? 'unknown' },
          dispatch: null,
        },
      };
    }
    const onResult = await this.lighting.setBrightnessOnGateway(slaveId, zone.daliGroup, 50);
    await new Promise((r) => setTimeout(r, 1200));
    const offResult = await this.lighting.setBrightnessOnGateway(slaveId, zone.daliGroup, 0);
    const allOk = onResult.ok && offResult.ok;
    return {
      message: allOk ? '测试已完成' : '测试失败 — modbus 阶段',
      data: {
        zone: { id: zone.id, code: zone.code, name: zone.name },
        gateway: { code: zone.gatewayCode, displayName: zone.gatewayDisplayName, slaveId },
        daliGroup: zone.daliGroup,
        routing: { ok: true },
        dispatch: {
          on:  { ok: onResult.ok,  error: onResult.error  ?? null, durationMs: onResult.durationMs, mock: onResult.mock },
          off: { ok: offResult.ok, error: offResult.error ?? null, durationMs: offResult.durationMs, mock: offResult.mock },
        },
      },
    };
  }
}
