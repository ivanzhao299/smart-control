import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AlertService } from './alert.service';
import { QueryAlertDto, ResolveAlertDto } from './dto/alert.dto';

@Controller('alerts')
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
