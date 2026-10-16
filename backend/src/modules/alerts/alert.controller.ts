import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AlertService } from './alert.service';
import { QueryAlertDto, ResolveAlertDto } from './dto/alert.dto';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';

/**
 * 报警中心。
 * - 读（list/summary/detail）：登录用户均可（前台/大屏告警横幅、首页报警数共用读）。
 * - 写（解除/忽略/按来源清除）：alerts 模块（config 运营处置 + admin），2026-10-16 收口；
 *   operator/hardware/viewer 不再能消警。
 */
@Controller('alerts')
@UseGuards(ModuleAccessGuard)
@ModuleAccess('alerts')
export class AlertController {
  constructor(private readonly service: AlertService) {}

  @Get()
  async list(@Query() q: QueryAlertDto) {
    const data = await this.service.findAll(q);
    return { message: '查询成功', data };
  }

  @Get('summary')
  async summary() {
    const data = await this.service.summary();
    return { message: '查询成功', data };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const data = await this.service.findOne(id);
    return { message: '查询成功', data };
  }

  @Post(':id/resolve')
  @HttpCode(200)
  async resolve(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveAlertDto,
  ) {
    const data = await this.service.resolve(id, dto.resolvedBy || 'admin');
    return { message: '已解除', data };
  }

  @Post(':id/ignore')
  @HttpCode(200)
  async ignore(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ResolveAlertDto,
  ) {
    const data = await this.service.ignore(id, dto.resolvedBy || 'admin');
    return { message: '已忽略', data };
  }

  /**
   * 按来源批量 resolve — 比如某个网关误报, 一键清掉所有它的 active 报警.
   * AlertBanner 上 "×" 按钮调这个 (设备旁的红色叉, 一键消干净).
   */
  @Post('resolve-by-source')
  @HttpCode(200)
  async resolveBySource(@Body() body: { sourceType?: string; sourceId?: string | null; resolvedBy?: string }) {
    if (!body?.sourceType) {
      return { message: 'sourceType 必填', data: { count: 0 } };
    }
    const count = await this.service.resolveBySource(
      body.sourceType,
      body.sourceId ?? null,
      body.resolvedBy || 'admin',
    );
    return { message: `已清除 ${count} 条`, data: { count } };
  }
}
