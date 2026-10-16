import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import {
  HperforDevicesService,
  HperforDeviceList,
  HperforStatus,
  HperforSyncResult,
} from './hperfor-devices.service';

/**
 * /api/integrations/hperfor — 华普云 HPERFOR ePa 智电云接入。
 * 设备清单 / 同步均为硬件台账写入，仅管理员；平台账号走后端环境变量。
 */
@Controller('integrations/hperfor')
@UseGuards(ActorAdminGuard)
export class HperforController {
  constructor(private readonly devices: HperforDevicesService) {}

  /** 接入状态：是否 mock、账号是否配置、已登记数量 */
  @Get('status')
  async status(): Promise<HperforStatus> {
    return this.devices.status();
  }

  /** 平台设备清单（含是否已登记标记），供同步前预览 */
  @Get('devices')
  async listDevices(): Promise<HperforDeviceList> {
    return this.devices.listDevices();
  }

  /** 拉平台设备并幂等导入硬件台账 + 电源回路（按 fId 去重，离线跳过） */
  @Post('sync')
  async sync(): Promise<HperforSyncResult> {
    return this.devices.syncToCatalog();
  }
}
