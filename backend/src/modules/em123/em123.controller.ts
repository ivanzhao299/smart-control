import {
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { Public } from '../../common/decorators/public.decorator';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { Em123Service } from './em123.service';

/**
 * em123 智慧能源平台只读 API (电表/水表)。
 *
 * - GET /api/em123/overview   @Public  电/水汇总、总表 vs 分表对比、分区/楼栋/区域排行、趋势。
 * - GET /api/em123/tree?type=E|W  @Public  分区→楼栋/区域→逐表明细下钻。
 * - POST /api/em123/sync       管理员   手动触发拉取。
 *
 * 数据来自登录后平台内部接口, 后端定时拉取并缓存, 不做远程拉合闸/写操作。
 */
@Public()
@Controller('em123')
export class Em123Controller {
  constructor(private readonly service: Em123Service) {}

  @Get('overview')
  overview() {
    return { message: '查询成功', data: this.service.getOverview() };
  }

  @Get('tree')
  async tree(@Query('type') type?: string) {
    const t = type === 'W' ? 'W' : 'E';
    return { message: '查询成功', data: await this.service.getTree(t) };
  }

  @Post('sync')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('energy')
  async sync(@Query('days') days?: string) {
    const n = Math.min(Number(days ?? 30) || 30, 365);
    await this.service.syncNow(n);
    return { message: '同步完成', data: this.service.getOverview() };
  }
}
