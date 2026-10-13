import {
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
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AdminGuard } from '../admin-auth/admin-auth.guard';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { Public } from '../../common/decorators/public.decorator';
import { LprService } from './lpr.service';
import type {
  DeviceCreateDto,
  DeviceUpsertDto,
  GateOpenDto,
  PlatformConfigUpdateDto,
  WhitelistUpsertDto,
} from './lpr.types';

/**
 * /api/lpr — PWA「道闸」页 / 后台 / 运营大屏使用的 API。
 * 公开只读 (@Public, 供现场无人值守大屏人车页拉取): devices / recent / stats
 *   - stats 仅聚合数字、devices 仅通道状态, 无敏感;
 *   - recent 为最近过车事件(大屏门岗实时流本就公开展示车牌), 不含抓拍图。
 * 需登录态: records(完整分页/按车牌检索)、whitelist(车主分组备注)、snaps(抓拍原图);
 * 配置写 (设备、白名单): 仅管理员;
 * 远程开闸: 值班可操作, 限速防双击 + 审计 + comet 下发。
 */
@Controller('lpr')
export class LprController {
  constructor(private readonly service: LprService) {}

  @Public()
  @Get('devices')
  async devices() {
    return { message: '查询成功', data: await this.service.listDevices() };
  }

  /** 管理员设备列表：含相机 web 后台账号/口令（公开 devices 接口不返回这些） */
  @Get('admin/devices')
  @UseGuards(AdminGuard)
  async adminDevices() {
    return { message: '查询成功', data: await this.service.listDevicesAdmin() };
  }

  /** 平台接入配置（标准参数，公开只读，供接入指引展示） */
  @Public()
  @Get('platform-config')
  async platformConfig() {
    return { message: '查询成功', data: await this.service.getPlatformConfig() };
  }

  /** 更新平台接入配置（仅管理员；只更新系统记录与接入指引，不远程改相机） */
  @Put('platform-config')
  @UseGuards(AdminGuard)
  async updatePlatformConfig(@Body() dto: PlatformConfigUpdateDto) {
    return { message: '已保存平台接入配置', data: await this.service.updatePlatformConfig(dto ?? {}) };
  }

  /** 按序列号预登记相机 (设备上线前手动录入; 序列号已存在则幂等更新), 仅管理员 */
  @Post('devices')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async createDevice(@Body() dto: DeviceCreateDto) {
    return { message: '已添加相机', data: await this.service.createDevice(dto ?? ({} as DeviceCreateDto)) };
  }

  @Put('devices/:id')
  @UseGuards(AdminGuard)
  async updateDevice(@Param('id', ParseIntPipe) id: number, @Body() dto: DeviceUpsertDto) {
    return { message: '已保存', data: await this.service.updateDevice(id, dto) };
  }

  @Public()
  @Get('recent')
  async recent(@Query('limit') limit?: string) {
    return { message: '查询成功', data: await this.service.recent(limit ? Number(limit) : 20) };
  }

  @Get('records')
  async records(
    @Query('plate') plate?: string,
    @Query('serialno') serialno?: string,
    @Query('date') date?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return {
      message: '查询成功',
      data: await this.service.records({
        plate,
        serialno,
        date,
        limit: limit ? Number(limit) : 50,
        offset: offset ? Number(offset) : 0,
      }),
    };
  }

  @Public()
  @Get('stats')
  async stats() {
    return { message: '查询成功', data: await this.service.stats() };
  }

  @Get('whitelist')
  async whitelist(@Query('group') group?: string) {
    return { message: '查询成功', data: await this.service.listWhitelist(group) };
  }

  @Post('whitelist')
  @UseGuards(AdminGuard)
  @HttpCode(200)
  async upsertWhitelist(@Body() dto: WhitelistUpsertDto, @Req() req: Request) {
    return { message: '已保存白名单', data: await this.service.upsertWhitelist(dto, this.operator(req)) };
  }

  @Delete('whitelist/:id')
  @UseGuards(AdminGuard)
  async removeWhitelist(@Param('id', ParseIntPipe) id: number, @Req() req: Request) {
    await this.service.removeWhitelist(id, this.operator(req));
    return { message: '已删除', data: null };
  }

  /** 远程手动开闸 (comet 方案 A): 相机在线立即下发, 否则排队等下一次通讯 */
  @Post('gate/open')
  @UseGuards(RateLimitGuard)
  @RateLimit({ max: 6, windowMs: 5000 })
  @HttpCode(200)
  async openGate(@Body() dto: GateOpenDto, @Req() req: Request) {
    const data = await this.service.openGate(dto ?? {}, this.operator(req) || 'pwa');
    return {
      message: data.delivered ? '开闸指令已下发' : '相机当前未连接, 已排队, 将在其下次通讯时开闸',
      data,
    };
  }

  /** 抓拍图 (读), 直出 image/jpeg, 不走统一包装 */
  @Get('snaps/:id/:kind')
  async snap(
    @Param('id', ParseIntPipe) id: number,
    @Param('kind') kind: 'small' | 'big',
    @Res() res: Response,
  ): Promise<void> {
    const k = kind === 'big' ? 'big' : 'small';
    const buf = await this.service.readSnap(id, k);
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.send(buf);
  }

  private operator(req: Request): string {
    const r = req as unknown as { user?: { username?: string }; actor?: { username?: string; name?: string } };
    return r.user?.username || r.actor?.username || r.actor?.name || 'pwa';
  }
}
