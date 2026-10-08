import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { EwelinkAuthService } from './ewelink-auth.service';
import { EwelinkDevicesService } from './ewelink-devices.service';

/**
 * /api/integrations/ewelink — 易微联云接入。
 * 配置/授权/同步/解绑仅管理员；callback 为易微联授权后重定向，@Public 放行。
 */
@Controller('integrations/ewelink')
export class EwelinkController {
  constructor(
    private readonly auth: EwelinkAuthService,
    private readonly devices: EwelinkDevicesService,
  ) {}

  /** 授权回调（易微联重定向，无我方登录态，须公开） */
  @Public()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('region') region: string,
    @Res() res: Response,
  ): Promise<void> {
    const page = (ok: boolean, msg: string): string => `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>易微联授权</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;
background:#0b0f17;color:#e6e9ef;font:16px -apple-system,BlinkMacSystemFont,"PingFang SC",sans-serif}
.card{max-width:360px;text-align:center;padding:32px;border:1px solid #232a36;border-radius:16px;background:#121722}
.dot{font-size:40px;margin-bottom:12px}</style></head>
<body><div class="card"><div class="dot">${ok ? '✅' : '⚠️'}</div><div>${msg}</div></div></body></html>`;
    if (!code) {
      res.status(400).type('text/html').send(page(false, '未收到授权码，请返回重试'));
      return;
    }
    try {
      await this.auth.handleCallback(code, region || 'cn');
      res.type('text/html').send(page(true, '易微联授权成功，可关闭本页面返回系统'));
    } catch (e) {
      res.status(400).type('text/html').send(page(false, (e as Error).message));
    }
  }

  @Get('status')
  async status() {
    return { message: '查询成功', data: await this.auth.status() };
  }

  @Post('config')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async config(@Body() body: { appId?: string; appSecret?: string } = {}) {
    if (!body?.appId?.trim() || !body?.appSecret?.trim()) {
      throw new BadRequestException('appId / appSecret 必填');
    }
    await this.auth.saveConfig(body.appId, body.appSecret);
    return { message: '已保存，现在可以开始授权', data: null };
  }

  @Post('authorize')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async authorize() {
    return { message: '请打开授权链接完成授权', data: { url: await this.auth.buildAuthorizeUrl() } };
  }

  @Get('devices')
  @UseGuards(ActorAdminGuard)
  async listDevices() {
    return { message: '查询成功', data: await this.devices.listSwitchThings() };
  }

  @Post('sync')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async sync() {
    return { message: '同步完成', data: await this.devices.syncToCatalog() };
  }

  @Post('unbind')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async unbind() {
    await this.auth.unbind();
    return { message: '已解除授权', data: null };
  }
}
