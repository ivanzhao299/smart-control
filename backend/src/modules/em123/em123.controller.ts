import {
  Body,
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseFilters,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { PermissionGuard } from '../../common/guards/permission.guard';
import type { AuthenticatedRequest } from '../../common/auth/actor';
import { requireActor } from '../../common/auth/actor';
import type { Em123WriteResult } from './em123.client';
import { Em123WriteExceptionFilter } from './em123-write-exception.filter';
import { Em123Service } from './em123.service';

/**
 * em123 智慧能源平台只读 API (电表/水表)。
 *
 * 大屏共用 (公开, 只读聚合):
 * - GET /api/em123/overview   @Public  电/水汇总、总表 vs 分表对比、分区/楼栋排行、趋势。
 * - GET /api/em123/tree?type=E|W  @Public  分区→楼栋/区域→逐表下钻。
 *
 * PWA 水电管理平台 (前台, 含户名/金额等运营数据, 按原子权限点放行; 物业角色可查/可导出):
 * - GET  /api/em123/arrears?type=E|W      欠费户清单 + 关口总表透支  [energy:detail]。
 * - GET  /api/em123/charges               缴费流水分页               [energy:detail]。
 * - GET  /api/em123/control-records       控制记录分页(只读留痕)     [energy:detail]。
 * - GET  /api/em123/export?kind=…         一键导出平台真实 xlsx       [energy:export]。
 * - POST /api/em123/readout               只读召测(仅触发一次抄表)    [energy:readout]。
 *
 * 二期写操作 (全程"先回显→校验→只发一次→成败留痕", 见 em123_write_log):
 * - GET  /api/em123/houses|users|refund-form/:id  回显            [energy:detail|rename|refund]。
 * - POST /api/em123/house/rename|user/rename|meter/edit  改名/档案 [energy:rename]。
 * - POST /api/em123/charge                现金/补量录入(金额上限+大额二次确认) [energy:recharge]。
 * - POST /api/em123/refund                退费(不得超原额)          [energy:refund]。
 * - POST /api/em123/reduction             减免(按住房核销应收,大额二次确认) [energy:refund]。
 *
 * 三期高危 (仅 admin, energy:control 不授任何角色):
 * - POST /api/em123/control  拉闸 wattoff/合闸 watton/校时 settime/多费率 setrate;
 *                            拉合闸须填原因 + 输入住房名强二次确认。
 * - GET  /api/em123/write-logs            写操作对账清单(留痕)。
 *
 * 手动同步:
 * - POST /api/em123/sync       管理员   手动触发拉取。
 *
 * 微信在线缴费由业主自助走汇付, PWA 不代收、不代发起; 写通道只发一次绝不自动重试。
 */
@Public()
@UseFilters(Em123WriteExceptionFilter)
@Controller('em123')
export class Em123Controller {
  constructor(private readonly service: Em123Service) {}

  /** 平台业务失败统一转 400 (留痕已在 service 落 failed); 成功原样返回。 */
  private settle(result: Em123WriteResult, okMsg: string) {
    if (!result.ok) throw new BadRequestException(result.msg || '平台拒绝了该操作');
    return { message: okMsg, data: result };
  }

  @Get('overview')
  overview() {
    return { message: '查询成功', data: this.service.getOverview() };
  }

  @Get('tree')
  async tree(@Query('type') type?: string) {
    const t = type === 'W' ? 'W' : 'E';
    return { message: '查询成功', data: await this.service.getTree(t) };
  }

  // ==================== PWA 水电管理平台（按原子权限点放行） ====================

  /** 欠费/透支明细: ?type=E|W。 */
  @Get('arrears')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail')
  async arrears(@Query('type') type?: string) {
    const t = type === 'W' ? 'W' : 'E';
    return { message: '查询成功', data: await this.service.getArrears(t) };
  }

  /** 缴费流水分页查询 (透传平台字段, 实时代理)。 */
  @Get('charges')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail')
  async charges(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listCharges(q ?? {}) };
  }

  /** 控制记录分页查询 (只读留痕)。 */
  @Get('control-records')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail')
  async controlRecords(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listControlRecords(q ?? {}) };
  }

  /** 一键导出真实 xlsx: kind=meter|charge|usage。 */
  @Get('export')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:export')
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
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:readout')
  async readout(@Body() body: { meterNo?: string; type?: 'E' | 'W' }) {
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    const type = body?.type === 'W' ? 'W' : 'E';
    const data = await this.service.requestReadout(meterNo, type);
    return { message: '召测已发起（只读，不改变开关/状态）', data };
  }

  // ==================== 二期：改名 / 档案 / 现金 / 退费（按权限点，全程留痕） ====================

  /** 住房（客户名）实时列表: ?keyword= 。改名前回显。 */
  @Get('houses')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail', 'energy:rename')
  async houses(@Query('keyword') keyword?: string, @Query('limit') limit?: string) {
    const data = await this.service.listHouses(keyword, Number(limit ?? 100) || 100);
    return { message: '查询成功', data };
  }

  /** 业主（户名）实时列表: ?userName=&pageNum=&pageSize= 。改名前回显。 */
  @Get('users')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail', 'energy:rename')
  async users(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listUsers(q ?? {}) };
  }

  /** 按表号回显改名/档案/收银上下文（表+住房+业主）。 */
  @Get('meter-context')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail', 'energy:rename', 'energy:recharge')
  async meterContext(
    @Query('type') type?: string,
    @Query('meterNo') meterNo?: string,
  ) {
    const meterType = type === 'W' ? 'W' : 'E';
    const no = String(meterNo ?? '').trim();
    if (!no) throw new BadRequestException('meterNo 不能为空');
    return { message: '查询成功', data: await this.service.getMeterContext(meterType, no) };
  }

  /** 退费表单回显: 原充值金额/户名/住房。 */
  @Get('refund-form/:recordId')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:refund')
  async refundForm(@Param('recordId') recordId: string) {
    return { message: '查询成功', data: await this.service.getRefundForm(recordId) };
  }

  /** 住房（客户名）改名: body { houseId, houseName, fullName?, parentId?, remark? }。 */
  @Post('house/rename')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:rename')
  async houseRename(@Req() req: AuthenticatedRequest, @Body() body: {
    houseId?: string | number;
    houseName?: string;
    fullName?: string;
    parentId?: string | number;
    remark?: string;
  }) {
    const actor = requireActor(req);
    if (body?.houseId == null || String(body.houseId).trim() === '') {
      throw new BadRequestException('houseId 不能为空');
    }
    const result = await this.service.renameHouse({ ...body, houseId: body.houseId, actor });
    return this.settle(result, '住房（客户名）已修改');
  }

  /** 业主（户名）改名 / 改电话: body { userId, userName, userPhone?, remark? }。 */
  @Post('user/rename')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:rename')
  async userRename(@Req() req: AuthenticatedRequest, @Body() body: {
    userId?: string | number;
    userName?: string;
    userPhone?: string;
    remark?: string;
  }) {
    const actor = requireActor(req);
    if (body?.userId == null || String(body.userId).trim() === '') {
      throw new BadRequestException('userId 不能为空');
    }
    const result = await this.service.renameUser({ ...body, userId: body.userId, actor });
    return this.settle(result, '业主户名已修改');
  }

  /** 表档案维护: body { meterType, meterNo, fields: { multiply?, priceId?, meterModel?, remark? } }。 */
  @Post('meter/edit')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:rename')
  async meterEdit(@Req() req: AuthenticatedRequest, @Body() body: {
    meterType?: 'E' | 'W';
    meterNo?: string;
    fields?: Record<string, string | number>;
  }) {
    const actor = requireActor(req);
    const meterType = body?.meterType === 'W' ? 'W' : 'E';
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    if (!body?.fields || Object.keys(body.fields).length === 0) {
      throw new BadRequestException('没有需要更新的档案字段');
    }
    const result = await this.service.editMeter({ meterType, meterNo, fields: body.fields, actor });
    return this.settle(result, '表档案已修改');
  }

  /**
   * 现金 / 补量录入: body { meterType, meterNo, mode: 'cash'|'replienish', amount, remark?, confirm? }。
   * 资金高危: 后端硬上限 + 大额二次确认; 不做微信在线支付。
   */
  @Post('charge')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:recharge')
  async charge(@Req() req: AuthenticatedRequest, @Body() body: {
    meterType?: 'E' | 'W';
    meterNo?: string;
    mode?: 'cash' | 'replienish';
    amount?: number;
    remark?: string;
    confirm?: boolean;
  }) {
    const actor = requireActor(req);
    const meterType = body?.meterType === 'W' ? 'W' : 'E';
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    const mode = body?.mode === 'replienish' ? 'replienish' : 'cash';
    const result = await this.service.cashCharge({
      meterType, meterNo, mode, amount: Number(body?.amount),
      remark: body?.remark, confirm: Boolean(body?.confirm), actor,
    });
    return this.settle(result, mode === 'replienish' ? '补量已录入' : '现金已录入');
  }

  /**
   * 退费: body { recordId, refundMoney, refundMode?: '0'|'1', remark?, confirm? }。
   * 退费金额不得超过原充值额; 现金单强制现金退费。
   */
  @Post('refund')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:refund')
  async refund(@Req() req: AuthenticatedRequest, @Body() body: {
    recordId?: string | number;
    refundMoney?: number;
    refundMode?: '0' | '1';
    remark?: string;
    confirm?: boolean;
  }) {
    const actor = requireActor(req);
    if (body?.recordId == null || String(body.recordId).trim() === '') {
      throw new BadRequestException('recordId 不能为空');
    }
    const result = await this.service.refund({
      recordId: body.recordId,
      refundMoney: Number(body?.refundMoney),
      refundMode: body?.refundMode,
      remark: body?.remark,
      confirm: Boolean(body?.confirm),
      actor,
    });
    return this.settle(result, '退费已提交');
  }

  /**
   * 减免: body { meterType, meterNo, reductionMoney, reason?, confirm? }。
   * 按该表所属住房核销应收, 金额为正、大额二次确认。
   */
  @Post('reduction')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:refund')
  async reduction(@Req() req: AuthenticatedRequest, @Body() body: {
    meterType?: 'E' | 'W';
    meterNo?: string;
    reductionMoney?: number;
    reason?: string;
    confirm?: boolean;
  }) {
    const actor = requireActor(req);
    if (body?.meterType !== 'E' && body?.meterType !== 'W') {
      throw new BadRequestException('meterType 必须为 E 或 W');
    }
    if (!body?.meterNo) throw new BadRequestException('meterNo 不能为空');
    const result = await this.service.reduction({
      meterType: body.meterType,
      meterNo: body.meterNo,
      reductionMoney: Number(body?.reductionMoney),
      reason: body?.reason,
      confirm: Boolean(body?.confirm),
      actor,
    });
    return this.settle(result, '减免已提交');
  }

  /**
   * 三期高危: 远程拉闸/合闸/校时。
   * body { action:'wattoff'|'watton'|'settime', meterType, meterNo, reason?, confirmName? }。
   * 仅 admin (energy:control 不授任何角色); 拉合闸须填原因 + 输入住房名强二次确认。
   * 多费率设置走独立的 setrate 端点 (需要回显费率方案 + rateId)。
   */
  @Post('control')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:control')
  async control(@Req() req: AuthenticatedRequest, @Body() body: {
    action?: 'wattoff' | 'watton' | 'settime';
    meterType?: 'E' | 'W';
    meterNo?: string;
    reason?: string;
    confirmName?: string;
  }) {
    const actor = requireActor(req);
    const action = body?.action;
    if (action !== 'wattoff' && action !== 'watton' && action !== 'settime') {
      throw new BadRequestException('action 必须是 wattoff / watton / settime');
    }
    const meterType = body?.meterType === 'W' ? 'W' : 'E';
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    const actionLabel = action === 'wattoff' ? '拉闸（断电）' : action === 'watton' ? '合闸（送电）' : '表计校时';
    const result = await this.service.remoteControl({
      action, meterType, meterNo, reason: body?.reason, confirmName: body?.confirmName, actor,
    });
    return this.settle(result, `${actionLabel}指令已下发`);
  }

  /** 多费率设置回显: ?meterType=E&meterNo=xxx，返回费率方案下拉。 */
  @Get('setrate-form')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:control')
  async setrateForm(@Query('meterType') meterType: string, @Query('meterNo') meterNo: string) {
    const type = meterType === 'W' ? 'W' : 'E';
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    return { message: '查询成功', data: await this.service.getSetRateForm(type, meterNo) };
  }

  /**
   * 三期高危: 多费率设置。
   * body { meterType, meterNo, rateId, reason?, confirmName? }。
   * 仅 admin; 须选有效费率方案 + 输入住房名强二次确认 + 填原因。
   */
  @Post('setrate')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:control')
  async setrate(@Req() req: AuthenticatedRequest, @Body() body: {
    meterType?: 'E' | 'W';
    meterNo?: string;
    rateId?: string;
    reason?: string;
    confirmName?: string;
  }) {
    const actor = requireActor(req);
    const meterType = body?.meterType === 'W' ? 'W' : 'E';
    const meterNo = String(body?.meterNo ?? '').trim();
    if (!meterNo) throw new BadRequestException('meterNo 不能为空');
    const result = await this.service.setRate({
      meterType, meterNo, rateId: body?.rateId, reason: body?.reason,
      confirmName: body?.confirmName, actor,
    });
    return this.settle(result, '多费率设置已下发');
  }

  /** 写操作对账清单（留痕）: ?bizType=&meterNo=&operator=&pageNum=&pageSize=。 */
  @Get('write-logs')
  @UseGuards(PermissionGuard)
  @RequirePermission('energy:detail', 'energy:recharge', 'energy:refund')
  async writeLogs(@Query() q: Record<string, string>) {
    return { message: '查询成功', data: await this.service.listWriteLogs(q ?? {}) };
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
