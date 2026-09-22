import { Controller, Get } from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { PvService } from './pv.service';

/**
 * 运营大屏「光伏发电」只读 API。
 *
 * - GET /api/pv-overview  @Public  大屏轮询读取; 后端定时 (默认 60s) 拉锦浪云并缓存。
 *   未配置凭证时 data.enabled=false, 前端回退内置静态展示, 不报错。
 *
 * 数据来自锦浪云 (Ginlong / SolisCloud) userStationList, 后端只做只读聚合,
 * 不暴露 KeyID/KeySecret, 也不做任何写操作。
 */
@Controller('pv-overview')
export class PvController {
  constructor(private readonly pv: PvService) {}

  @Public()
  @Get()
  get(): { success: true; data: ReturnType<PvService['getOverview']> } {
    return { success: true, data: this.pv.getOverview() };
  }
}
