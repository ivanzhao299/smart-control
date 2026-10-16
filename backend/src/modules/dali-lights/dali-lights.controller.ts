import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { WriteRoleGuard } from '../../common/guards/write-role.guard';
import { WriteRoles } from '../../common/decorators/write-roles.decorator';
import { UseGuards } from '@nestjs/common';
import {
  BadRequestException,
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
import { DaliLightsService, LightCmd } from './dali-lights.service';

/**
 * DALI 单灯管理 API —— 现场调试/命名/分组/场景。
 *
 * 2026-10-16 第二轮最小权限收敛：DALI 灯光属设备实体控制，所有写操作（含分区控制
 * controlZone、场景召回 recallScene，以及扫描/诊断/命名/编组/共享场景）一律仅 admin；
 * 首页场景执行经 SceneEngine 服务层触发 DALI（不走本 HTTP），operator 执行场景不受影响。
 * 物理接触或局域网地址不能替代服务端角色验证。
 */
@Controller('dali-lights')
@UseGuards(WriteRoleGuard)
@WriteRoles('admin')
export class DaliLightsController {
  constructor(private readonly service: DaliLightsService) {}

  /** 网关列表(给前端选网关) */
  @Get('gateways')
  async gateways() {
    return { message: '查询成功', data: await this.service.getGateways() };
  }

  /** 所有已发现的灯 */
  @Get()
  async list() {
    return { message: '查询成功', data: await this.service.list() };
  }

  /** 扫描发现(body.gatewayCode 可选, 不填扫全部) */
  @Post('scan')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async scan(@Body() body: { gatewayCode?: string } = {}) {
    return { message: '扫描完成', data: await this.service.scan(body?.gatewayCode) };
  }

  // ============ 总线体检 (实时读+按地址闪/控, 不落库) ============
  // 注意: 这几条静态路由必须声明在下面 :id/* 之前, 否则 'diagnose' 会被当成 :id 走 ParseIntPipe 报 400。

  /** 实时读全部(或指定 ?gateway=)网关的 1-64 槽位占用图, 不落库 */
  @Get('diagnose')
  @UseGuards(ActorAdminGuard)
  async diagnose(@Query('gateway') gateway?: string) {
    return { message: '体检完成', data: await this.service.diagnose(gateway) };
  }

  /** 体检: 按 (网关, 短地址) 闪 —— 空号/未登记地址也能点 */
  @Post('diagnose/identify')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async diagnoseIdentify(@Body() body: { gatewayCode?: string; short?: number } = {}) {
    if (!body?.gatewayCode || typeof body?.short !== 'number') {
      throw new BadRequestException('gatewayCode + short 必填');
    }
    return { message: '已发送闪烁', data: await this.service.identifyAddr(body.gatewayCode, body.short) };
  }

  /** 体检: 按 (网关, 短地址) 直控 —— 排查"控制不了" */
  @Post('diagnose/control')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async diagnoseControl(@Body() body: { gatewayCode?: string; short?: number } & LightCmd = {}) {
    if (!body?.gatewayCode || typeof body?.short !== 'number') {
      throw new BadRequestException('gatewayCode + short 必填');
    }
    const { gatewayCode, short, ...cmd } = body;
    return { message: '已下发', data: await this.service.controlAddr(gatewayCode, short, cmd) };
  }

  /** 闪烁识别某盏灯 */
  @Post(':id/identify')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async identify(@Param('id', ParseIntPipe) id: number) {
    return { message: '已发送闪烁', data: await this.service.identify(id) };
  }

  /** 单灯直控 */
  @Post(':id/control')
  @HttpCode(200)
  async control(@Param('id', ParseIntPipe) id: number, @Body() cmd: LightCmd = {}) {
    return { message: '已下发', data: await this.service.setLight(id, cmd) };
  }

  /** 命名 */
  @Put(':id/name')
  @UseGuards(ActorAdminGuard)
  async rename(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string } = {}) {
    if (typeof body?.name !== 'string') throw new BadRequestException('name 必填');
    return { message: '已改名', data: await this.service.rename(id, body.name) };
  }

  /** 分到分区(zoneCode 传 null/空 = 移出) */
  @Put(':id/zone')
  @UseGuards(ActorAdminGuard)
  async assignZone(@Param('id', ParseIntPipe) id: number, @Body() body: { zoneCode?: string | null } = {}) {
    return { message: '已分配', data: await this.service.assignZone(id, body?.zoneCode ?? null) };
  }

  /** 批量分区 */
  @Post('assign-zone')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async assignZoneBatch(@Body() body: { ids?: number[]; zoneCode?: string | null } = {}) {
    if (!Array.isArray(body?.ids)) throw new BadRequestException('ids 必填');
    const n = await this.service.assignZoneBatch(body.ids, body?.zoneCode ?? null);
    return { message: `已分配 ${n} 盏`, data: { affected: n } };
  }

  /** 分区整体控制 */
  @Post('zones/:zoneCode/control')
  @HttpCode(200)
  async controlZone(@Param('zoneCode') zoneCode: string, @Body() cmd: LightCmd = {}) {
    return { message: '已下发', data: await this.service.controlZone(zoneCode, cmd) };
  }

  // ============ 场景 ============

  @Get('scenes')
  async listScenes() {
    return { message: '查询成功', data: await this.service.listScenes() };
  }

  @Post('scenes')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async createScene(@Body() body: Parameters<DaliLightsService['createScene']>[0]) {
    return { message: '场景已创建', data: await this.service.createScene(body) };
  }

  @Put('scenes/:code')
  @UseGuards(ActorAdminGuard)
  async updateScene(
    @Param('code') code: string,
    @Body() body: Parameters<DaliLightsService['updateScene']>[1],
  ) {
    return { message: '场景已保存', data: await this.service.updateScene(code, body) };
  }

  @Delete('scenes/:code')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async deleteScene(@Param('code') code: string) {
    await this.service.deleteScene(code);
    return { message: '场景已删除', data: null };
  }

  @Post('scenes/:code/recall')
  @HttpCode(200)
  async recallScene(@Param('code') code: string) {
    return { message: '场景已调用', data: await this.service.recallScene(code) };
  }
}
