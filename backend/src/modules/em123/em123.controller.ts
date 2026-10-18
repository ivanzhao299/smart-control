import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Em123Service } from './em123.service';

/**
 * em123 智慧能源平台只读 API (电表/水表)。
 *
 * 大屏共用 (公开, 只读聚合):
 * - GET /api/em123/overview   @Public  电/水汇总、总表 vs 分表对比、分区/楼栋排行、趋势。
 * - GET /api/em123/tree?type=E|W  @Public  分区→楼栋/区域→逐表下钻。
 *
 * 一期 PWA 能源管理后台 (含户名/金额/操作员等敏感运营数据, 仅 admin):
 * - GET  /api/em123/arrears?type=E|W      欠费户清单 + 关口总表透支(两个口径分开)。
 * - GET  /api/em123/charges               缴费流水分页(方式/状态/时间/关键字)。
 * - GET  /api/em123/control-records       控制记录分页(只读留痕)。
 * - GET  /api/em123/export?kind=…         一键导出平台真实 xlsx(后端两步代理)。
 * - POST /api/em123/readout               只读召测(仅触发一次抄表, 不改状态)。
 *
 * 手动同步:
 * - POST /api/em123/sync       管理员   手动触发拉取。
 *
 * 数据来自登录后平台内部接口, 后端定时拉取聚合 + 管理查询实时代理;
 * 不做远程拉合闸/改名/充值/退费等任何写操作。
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

  // ==================== 一期 PWA 能源管理后台 (仅 admin) ====================

  /** 欠费/透支明细: ?type=E|W。 */
  @Get('arrears')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async arrears(@Query('type') type?: string) {
    const t = type === 'W' ? 'W' : 'E';
    return { message: '查询成功', data: await this.service.getArrears(t) };
  }

  /** 缴费流水分页查询 (透传平台字段, 实时代理)。 */
  @Get('charges')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async charges(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listCharges(q ?? {}) };
  }

  /** 控制记录分页查询 (只读留痕)。 */
  @Get('control-records')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async controlRecords(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listControlRecords(q ?? {}) };
  }

  /** 一键导出真实 xlsx: kind=meter|charge|usage。 */
  @Get('export')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async exportXlsx(
    @Query() q: Record<string, string>,
    @Res() res: Response,
  ): Promise<void> {
    const kind = q?.kind;
    if (kind !== 'meter' && kind !== 'charge' && kind !== 'usage') {
      throw new BadRequestException('kind 必须是 meter / charge / usage');
    }
    const { buffer, fileName } = await this.service.exportXlsx(kind, q ?? {});
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
    );
    res.setHeader('Content-Length', String(buffer.length));
    res.send(buffer);
  }

  /** 只读召测: body { meterNo, type: 'E'|'W' }, 仅触发一次抄表, 不改开关/状态。 */
  @Post('readout')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async readout(@Body() body: { meterNo?: string; type?: 'E' | 'W' }) {
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    const type = body?.type === 'W' ? 'W' : 'E';
    const data = await this.service.requestReadout(meterNo, type);
    return { message: '召测已发起（只读，不改变开关/状态）', data };
  }

  // ==================== 手动同步 ====================

  @Post('sync')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('energy')
  async sync(@Query('days') days?: string) {
    const n = Math.min(Number(days ?? 30) || 30, 365);
    await this.service.syncNow(n);
    return { message: '同步完成', data: this.service.getOverview() };
  }
}
