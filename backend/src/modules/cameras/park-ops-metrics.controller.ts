import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  Put,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { ParkOpsMetricsService } from './park-ops-metrics.service';

/**
 * 运营大屏「业务数字文档」API。权威数据由 RuntimeConfigStore 版本化保存，
 * 旧 JSON 只在首次迁移时读取，后续更新不再写回文件。
 *
 * 文档结构与 frontend/public/park-ops/ops-data-model.mjs 对齐:
 *   { version:1, source, updatedAt(ISO), placeholderKeys:string[],
 *     metrics:{ [key]: number|null }, content:{ [key]: string|string[] } }
 *
 * - GET  /api/park-ops-metrics   @Public  大屏/校准器轮询读取; 从未保存时 data:null, 前端回退内置默认
 * - PUT  /api/park-ops-metrics   AdminGuard 仅 PWA 后台管理员可写 (手机端"运营数据"卡片)
 *
 * 后端负责结构与边界校验；业务强校验（整数、百分比、产业结构合计等）仍由前端
 * 共用 validate 负责。每次有效修改都会生成数据库修订和 SHA-256 校验和。
 */
@Controller('park-ops-metrics')
export class ParkOpsMetricsController {
  constructor(private readonly metrics: ParkOpsMetricsService) {}

  @Public()
  @Get()
  get(): { success: boolean; data: unknown } {
    return { success: true, data: this.metrics.get() };
  }

  @Put()
  @UseGuards(AdminGuard)
  async update(
    @Body() body: unknown,
  ): Promise<{ success: boolean; message: string; data: unknown }> {
    try {
      const doc = await this.metrics.update(body);
      return { success: true, message: '运营数据已保存并发布到运营大屏', data: doc };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new BadRequestException((error as Error).message);
    }
  }
}
