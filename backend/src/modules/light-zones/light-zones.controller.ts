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
import { AssignGroupsDto, GroupShortsDto } from './dto/group.dto';

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

  /**
   * 全部 DALI 组 (含未分区的).
   *
   * **必须声明在 @Get(':id') 之前** —— Nest 按声明顺序匹配, 放后面的话 'groups'
   * 会先落到 :id 上被 ParseIntPipe 拒掉 400。
   */
  @Get('groups')
  async groups() {
    return { message: '查询成功', data: await this.service.listGroups() };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    return { message: '查询成功', data: await this.service.detail(id) };
  }

  /**
   * 把若干个组归到某个分区 (zoneCode=null 表示从分区里移出, 变成未分配).
   * 前端"编组模式"就调这个。
   */
  @Post('groups/assign')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async assignGroups(@Body() dto: AssignGroupsDto) {
    const data = await this.service.assignGroups(dto.groupIds, dto.zoneCode ?? null);
    return { message: '分配成功', data };
  }

  /** 记录某组实测到的灯具短地址 (现场点灯时逐个填) */
  @Put('groups/:groupId/shorts')
  @UseGuards(AdminGuard)
  async setGroupShorts(
    @Param('groupId', ParseIntPipe) groupId: number,
    @Body() dto: GroupShortsDto,
  ) {
    return { message: '更新成功', data: await this.service.setGroupShorts(groupId, dto.shorts) };
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
    const head = { id: zone.id, code: zone.code, name: zone.name };

    let targets: Array<{ slaveId: number; daliGroup: number; gatewayCode: string }>;
    try {
      targets = (await this.service.resolveForCommand(id)).targets;
    } catch (err) {
      return {
        message: '测试失败 — 路由解析阶段',
        data: { zone: head, routing: { ok: false, error: (err as Error).message }, dispatch: null },
      };
    }
    if (targets.length === 0) {
      return {
        message: '该分区暂无灯组',
        data: { zone: head, routing: { ok: false, error: 'no groups' }, dispatch: null },
      };
    }

    // 逐组 50% → 停 1.2s → 关. 串行: 共用一条 RS485, 并发帧会互踩.
    // 一次测一组, 现场能看出"哪几盏灯属于这个分区" —— 这正是业主要用它核对分组的场景.
    const dispatch: Array<Record<string, unknown>> = [];
    for (const t of targets) {
      const on = await this.lighting.setBrightnessOnGateway(t.slaveId, t.daliGroup, 50);
      await new Promise((r) => setTimeout(r, 1200));
      const off = await this.lighting.setBrightnessOnGateway(t.slaveId, t.daliGroup, 0);
      dispatch.push({
        gateway: { code: t.gatewayCode, slaveId: t.slaveId },
        daliGroup: t.daliGroup,
        on:  { ok: on.ok,  error: on.error  ?? null, durationMs: on.durationMs, mock: on.mock },
        off: { ok: off.ok, error: off.error ?? null, durationMs: off.durationMs, mock: off.mock },
      });
    }
    const okCount = dispatch.filter((d) => (d.on as { ok: boolean }).ok && (d.off as { ok: boolean }).ok).length;
    const allOk = okCount === dispatch.length;
    return {
      message: allOk ? '测试已完成' : `测试失败 — modbus 阶段 (${okCount}/${dispatch.length} 组成功)`,
      data: { zone: head, routing: { ok: true }, total: dispatch.length, okCount, dispatch },
    };
  }
}
