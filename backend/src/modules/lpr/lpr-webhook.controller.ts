import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { LprService } from './lpr.service';
import type { AlarmPlateBody, GateStatusBody } from './lpr.types';

/**
 * 臻识相机 -> 后端 的公开回调 (无我方登录态, 以 serialno 作设备身份)。
 * 全部 @Public, 并用 @Res() 直接回裸 JSON, 绕过统一响应包装
 * (相机只认协议规定的 Response_AlarmInfoPlate 结构)。
 *
 * 端点 (在相机网页"高级设置 -> HTTP 推送"配置, 前缀 https://域名/api/lpr):
 *   POST /plate     识别结果 AlarmInfoPlate (核心)
 *   POST /gio       IO 触发 AlarmGioIn
 *   POST /serial    485 透传 SerialData
 *   POST /snap       主动截图 TriggerImage
 *   POST /heartbeat 注册/心跳 (multipart/form-data)
 *   GET|POST /comet comet 长轮询 (远程开闸/即时白名单方案 A)
 */
@Controller('lpr')
export class LprWebhookController {
  constructor(private readonly service: LprService) {}

  @Public()
  @Post('plate')
  @HttpCode(200)
  async plate(@Body() body: AlarmPlateBody, @Req() req: Request, @Res() res: Response): Promise<void> {
    const reply = await this.service.handlePlate(body ?? {}, req.ip);
    res.json(reply);
  }

  @Public()
  @Post('gio')
  @HttpCode(200)
  async gio(@Res() res: Response): Promise<void> {
    res.json({});
  }

  @Public()
  @Post('serial')
  @HttpCode(200)
  async serial(@Res() res: Response): Promise<void> {
    res.json({});
  }

  @Public()
  @Post('snap')
  @HttpCode(200)
  async snap(@Res() res: Response): Promise<void> {
    res.json({});
  }

  /** 道闸状态通知 (cmd=barr_gate_status_notify), 与识别推送同一套 JSON, 单独路径便于现场配置 */
  @Public()
  @Post('gate-status')
  @HttpCode(200)
  async gateStatus(@Body() body: GateStatusBody, @Res() res: Response): Promise<void> {
    await this.service.handleGateStatus(body ?? {});
    res.json({});
  }

  @Public()
  @Post('heartbeat')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file'))
  async heartbeat(
    @Body() body: Record<string, string> = {},
    @UploadedFile() _file: unknown,
    @Req() req: Request,
    @Res() res: Response,
  ): Promise<void> {
    const serialno = String(body.serialno ?? body.sn ?? '').trim();
    await this.service.heartbeat(serialno, {
      ip: req.ip,
      deviceName: body.deviceName ?? body.manufacture ?? null,
      model: body.deviceModel ?? null,
      channel: body.channel ? Number(body.channel) : null,
    });
    // 心跳成功的具体回执以现场固件要求为准, 阶段0回 200 + 空 JSON
    res.json({});
  }

  /** comet 长轮询: 相机挂连接, 服务器在有开闸/白名单命令时随回复下发, 否则挂起到超时 */
  @Public()
  @Get('comet')
  @Post('comet')
  @HttpCode(200)
  async comet(
    @Body() body: Record<string, string> = {},
    @Query('serialno') querySerialno?: string,
    @Req() req?: Request,
    @Res() res?: Response,
  ): Promise<void> {
    const serialno = String(body?.serialno ?? querySerialno ?? '').trim();
    const reply = await this.service.cometPoll(serialno, { ip: req?.ip });
    res!.json(reply);
  }
}
