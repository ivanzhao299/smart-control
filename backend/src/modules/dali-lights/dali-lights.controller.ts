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
} from '@nestjs/common';
import { DaliLightsService, LightCmd } from './dali-lights.service';

/**
 * DALI 单灯管理 API —— 现场调试/命名/分组/场景。
 *
 * 鉴权: 跟灯光控制同级(日常操作), 不卡 admin token —— 现场平板/手机随时要用。
 * 进入展厅=物理接触, 已过安全边界(与 playback / lighting 一致)。
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
  @HttpCode(200)
  async scan(@Body() body: { gatewayCode?: string } = {}) {
    return { message: '扫描完成', data: await this.service.scan(body?.gatewayCode) };
  }

  /** 闪烁识别某盏灯 */
  @Post(':id/identify')
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
  async rename(@Param('id', ParseIntPipe) id: number, @Body() body: { name?: string } = {}) {
    if (typeof body?.name !== 'string') throw new BadRequestException('name 必填');
    return { message: '已改名', data: await this.service.rename(id, body.name) };
  }

  /** 分到分区(zoneCode 传 null/空 = 移出) */
  @Put(':id/zone')
  async assignZone(@Param('id', ParseIntPipe) id: number, @Body() body: { zoneCode?: string | null } = {}) {
    return { message: '已分配', data: await this.service.assignZone(id, body?.zoneCode ?? null) };
  }

  /** 批量分区 */
  @Post('assign-zone')
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
  @HttpCode(200)
  async createScene(@Body() body: Parameters<DaliLightsService['createScene']>[0]) {
    return { message: '场景已创建', data: await this.service.createScene(body) };
  }

  @Put('scenes/:code')
  async updateScene(
    @Param('code') code: string,
    @Body() body: Parameters<DaliLightsService['updateScene']>[1],
  ) {
    return { message: '场景已保存', data: await this.service.updateScene(code, body) };
  }

  @Delete('scenes/:code')
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
