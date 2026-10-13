import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { EnergyService } from './energy.service';
import { ModuleAccessGuard } from '../../common/guards/module-access.guard';
import { ModuleAccess } from '../../common/decorators/module-access.decorator';
import { Public } from '../../common/decorators/public.decorator';

/**
 * 能源管理：总览 / 趋势 / 回路占比。
 * 读接口公开（业主端电源页与管理端能源页都用）；手动云同步仅管理员。
 */
@Public()
@Controller('energy')
export class EnergyController {
  constructor(private readonly service: EnergyService) {}

  @Get('dashboard')
  async dashboard() {
    return { message: '查询成功', data: await this.service.dashboard() };
  }

  /** 读取园区能源台账（变压器/楼栋/电梯），含 revision 用于乐观锁。 */
  @Get('assets')
  async assets() {
    return { message: '查询成功', data: await this.service.getAssets() };
  }

  /** 保存园区能源台账（仅管理员，CAS：revision 过期返回 409）。 */
  @Put('assets')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('energy')
  async saveAssets(
    @Body() body: { expectedRevision?: number; value?: unknown },
  ) {
    const expectedRevision = Number(body?.expectedRevision);
    if (!Number.isInteger(expectedRevision) || expectedRevision < 1) {
      throw new BadRequestException('expectedRevision 必须为正整数');
    }
    return {
      message: '保存成功',
      data: await this.service.saveAssets(body?.value, expectedRevision),
    };
  }

  @Get('overview')
  async overview() {
    return { message: '查询成功', data: await this.service.overview() };
  }

  @Get('trend')
  async trend(
    @Query('groupBy') groupBy?: string,
    @Query('days') days?: string,
  ) {
    const gb = groupBy === 'month' ? 'month' : 'day';
    const n = Math.min(Number(days ?? 30) || 30, 365);
    return {
      message: '查询成功',
      data: await this.service.trend(gb as 'day' | 'month', n),
    };
  }

  @Get('breakdown')
  async breakdown(@Query('days') days?: string) {
    const n = Math.min(Number(days ?? 30) || 30, 365);
    return { message: '查询成功', data: await this.service.breakdown(n) };
  }

  /** 手动触发云电量同步（平台 device-total），仅管理员 */
  @Post('sync')
  @UseGuards(ModuleAccessGuard)
  @ModuleAccess('energy')
  async sync(@Query('days') days?: string) {
    const n = Math.min(Number(days ?? 30) || 30, 365);
    return {
      message: '同步完成',
      data: await this.service.syncCloud(n),
    };
  }
}
