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
  UseGuards,
} from '@nestjs/common';
import {
  PowerCircuitsService,
  type PowerCircuitUpsertDto,
  type PowerDomainUpsertDto,
} from './power-circuits.service';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { WriteRoleGuard } from '../../common/guards/write-role.guard';
import { WriteRoles } from '../../common/decorators/write-roles.decorator';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { PowerDomainGrantService, type DomainGrantItem } from './power-domain-grant.service';

/**
 * 电源回路 CRUD + 通断 + 电源域.
 *
 * 域划分（2026-10-17）：回路挂在 hall 展厅 / park 园区 等域下，授权是二维的：
 *  - 方法级 @WriteRoles 只决定"哪个角色能调电源控制"（粗粒度）；
 *  - service 内再按回路 domainCode 做资源级校验（细粒度，operator 越界园区 /
 *    config 越界展厅均 403），list/detail 按角色域做数据范围过滤。
 *
 * 写 (create/update/delete/rename): 后台 zones 模块（仅 admin）
 * 通断 (on/off): admin 全域；hardware 全域；operator 仅展厅；config 仅园区；限速防双击
 * 时序器全开/全关 (sequencer): 仅 admin（批量上下电，高风险）
 * 电源域 (power-domains): 读任何登录用户；增删改仅 admin（zones）
 */
@Controller()
export class PowerCircuitsController {
  constructor(
    private readonly service: PowerCircuitsService,
    private readonly grants: PowerDomainGrantService,
  ) {}

  @Get('power-circuits')
  async list(@Req() req: AuthenticatedRequest, @Query('includeDisabled') includeDisabled?: string) {
    const include = includeDisabled === '1' || includeDisabled === 'true';
    const role = requireActor(req).role;
    return {
      message: '查询成功',
      data: await this.service.list({ includeDisabled: include, role }),
    };
  }

  // ============ 电源域 ============

  /** 域字典：任何已登录用户可见（按角色域过滤后返回自己可见的域，供分组/下拉）。 */
  @Get('power-domains')
  async listDomains(@Req() req: AuthenticatedRequest, @Query('includeDisabled') includeDisabled?: string) {
    const role = requireActor(req).role;
    const include = includeDisabled === '1' || includeDisabled === 'true';
    const all = await this.service.listDomains({ includeDisabled: include });
    const readable = await this.grants.readableDomains(role);
    const data = readable === null ? all : all.filter((d) => readable.includes(d.code));
    return { message: '查询成功', data };
  }

  @Post('power-domains')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async createDomain(@Body() dto: PowerDomainUpsertDto) {
    return { message: '创建成功', data: await this.service.createDomain(dto) };
  }

  @Put('power-domains/:id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async updateDomain(@Param('id', ParseIntPipe) id: number, @Body() dto: Partial<PowerDomainUpsertDto>) {
    return { message: '更新成功', data: await this.service.updateDomain(id, dto) };
  }

  @Delete('power-domains/:id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  @HttpCode(200)
  async removeDomain(@Param('id', ParseIntPipe) id: number) {
    await this.service.removeDomain(id);
    return { message: '删除成功', data: null };
  }

  // ============ 角色 × 电源域授权矩阵（仅 admin；@ModuleAccess('zones') 锁定） ============

  /** 矩阵：启用域 + 可配置角色(动态) + 锁定角色(admin/hardware) + 当前授权。 */
  @Get('power-domain-grants')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async listDomainGrants() {
    return { message: '查询成功', data: await this.grants.getMatrix() };
  }

  /** 全量保存授权矩阵（事务替换；锁定角色的行一律忽略；可写隐含可读）。 */
  @Put('power-domain-grants')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async saveDomainGrants(@Body() body: { grants?: DomainGrantItem[] }) {
    const grants = Array.isArray(body?.grants) ? body.grants : [];
    await this.grants.replaceGrants(grants);
    return { message: '保存成功', data: await this.grants.getMatrix() };
  }

  // ============ 时序器 (EPO-802P / SEQ55) ============
  // ⚠️ 路由顺序: 'sequencer/*' 必须声明在 ':id' 参数路由之前, 否则被 ParseIntPipe 吃掉 400。
  // 两台时序器各自独立: 必须带 gatewayCode 指定操作哪一台, 禁止一个按钮同时控两台。

  /** 时序开机 (EPO b3 / SEQ55 0D) — 设备按各路延时依次上电, 保护功放；仅 admin */
  @Post('power-circuits/sequencer/all-on')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin')
  @RateLimit({ max: 2, windowMs: 3000 })
  async seqAllOn(@Body() body: { gatewayCode?: string } = {}) {
    await this.service.sequencerAll(true, body?.gatewayCode);
    return { message: '时序开机已下发, 各路按延时依次上电', data: { on: true } };
  }

  /** 时序关机 (EPO b3 / SEQ55 0D) — 先开的后关, 依次断电；仅 admin */
  @Post('power-circuits/sequencer/all-off')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin')
  @RateLimit({ max: 2, windowMs: 3000 })
  async seqAllOff(@Body() body: { gatewayCode?: string } = {}) {
    await this.service.sequencerAll(false, body?.gatewayCode);
    return { message: '时序关机已下发, 各路按延时依次断电', data: { on: false } };
  }

  /** 改名影响所有用户的共享配置，仅管理员；on/off仍为日常控制。 */
  @Post('power-circuits/:id/rename')
  @UseGuards(ModuleAccessGuard, RateLimitGuard)
  @ModuleAccess('zones')
  @RateLimit({ max: 4, windowMs: 1000 })
  async rename(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string } = {}) {
    return { message: '已改名', data: await this.service.rename(id, body.name ?? '') };
  }

  /** 智能断路器全量计量: 三相分相电压/电流 + 漏电 + 4 路接线柱温度 + 报警位 */
  @Get('power-circuits/:id/breaker')
  async breaker(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const role = requireActor(req).role;
    return { message: '查询成功', data: await this.service.breakerMeasurements(id, role) };
  }

  @Get('power-circuits/:id')
  async detail(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const role = requireActor(req).role;
    return { message: '查询成功', data: await this.service.detail(id, role) };
  }

  @Post('power-circuits')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async create(@Body() dto: PowerCircuitUpsertDto) {
    return { message: '创建成功', data: await this.service.create(dto) };
  }

  @Put('power-circuits/:id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: Partial<PowerCircuitUpsertDto>,
  ) {
    return { message: '更新成功', data: await this.service.update(id, dto) };
  }

  @Delete('power-circuits/:id')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('zones')
  @HttpCode(200)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.service.remove(id);
    return { message: '删除成功', data: null };
  }

  // ============ 通断 (限速) ============
  // 方法级守卫放行四个角色（config 园区域手动测试由此补回），具体这一路属不属于
  // 该角色的操作域，由 service.turnOnForRole/turnOffForRole 按回路 domainCode 二次校验。

  @Post('power-circuits/:id/on')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin', 'hardware', 'config', 'operator')
  @RateLimit({ max: 4, windowMs: 1000 })
  async on(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const role = requireActor(req).role;
    return { message: '通电成功', data: await this.service.turnOnForRole(id, role) };
  }

  @Post('power-circuits/:id/off')
  @UseGuards(RateLimitGuard, WriteRoleGuard)
  @WriteRoles('admin', 'hardware', 'config', 'operator')
  @RateLimit({ max: 4, windowMs: 1000 })
  async off(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number) {
    const role = requireActor(req).role;
    return { message: '断电成功', data: await this.service.turnOffForRole(id, role) };
  }
}
