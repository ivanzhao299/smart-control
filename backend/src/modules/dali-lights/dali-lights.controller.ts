import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
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
  Req,
} from '@nestjs/common';
import { DaliLightsService, LightCmd } from './dali-lights.service';
import {
  AssignDaliLightBatchDto,
  AssignDaliLightZoneDto,
  CreateDaliSceneDto,
  RenameDaliLightDto,
  UpdateDaliSceneDto,
  DaliSceneRevisionQueryDto,
} from './dto/dali-metadata.dto';
import { AuthenticatedRequest, requireAdmin } from '../../common/auth/actor';

/**
 * DALI 单灯管理 API —— 现场调试/命名/分组/场景。
 *
 * 日常控制允许operator；扫描、诊断、命名、编组和共享场景定义仅管理员。
 * 物理接触或局域网地址不能替代服务端角色验证。
 */
@Controller('dali-lights')
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
  async rename(@Param('id', ParseIntPipe) id: number, @Body() body: RenameDaliLightDto, @Req() req: AuthenticatedRequest) {
    return { message: '已改名', data: await this.service.rename(id, body.name, body.expectedRevision, requireAdmin(req)) };
  }

  /** 分到分区(zoneCode 传 null/空 = 移出) */
  @Put(':id/zone')
  @UseGuards(ActorAdminGuard)
  async assignZone(@Param('id', ParseIntPipe) id: number, @Body() body: AssignDaliLightZoneDto, @Req() req: AuthenticatedRequest) {
    return { message: '已分配', data: await this.service.assignZone(id, body?.zoneCode ?? null, body.expectedRevision, requireAdmin(req)) };
  }

  /** 批量分区 */
  @Post('assign-zone')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async assignZoneBatch(@Body() body: AssignDaliLightBatchDto, @Req() req: AuthenticatedRequest) {
    const n = await this.service.assignZoneBatch(body.ids, body.zoneCode ?? null, body.expectedRevisions, requireAdmin(req));
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
  async createScene(@Body() body: CreateDaliSceneDto, @Req() req: AuthenticatedRequest) {
    return { message: '场景已创建', data: await this.service.createScene(body, requireAdmin(req)) };
  }

  @Put('scenes/:code')
  @UseGuards(ActorAdminGuard)
  async updateScene(
    @Param('code') code: string,
    @Body() body: UpdateDaliSceneDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return { message: '场景已保存', data: await this.service.updateScene(code, body, body.expectedRevision, requireAdmin(req)) };
  }

  @Delete('scenes/:code')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async deleteScene(@Param('code') code: string, @Query() query: DaliSceneRevisionQueryDto, @Req() req: AuthenticatedRequest) {
    await this.service.deleteScene(code, query.expectedRevision, requireAdmin(req));
    return { message: '场景已删除', data: null };
  }

  @Post('scenes/:code/recall')
  @HttpCode(200)
  async recallScene(@Param('code') code: string) {
    return { message: '场景已调用', data: await this.service.recallScene(code) };
  }
}
