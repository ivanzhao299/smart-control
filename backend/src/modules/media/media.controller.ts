import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { diskStorage } from 'multer';
import { extname, join } from 'path';
import { mkdirSync } from 'fs';
import { spawn } from 'child_process';
import { MediaService } from './media.service';
import { MediaUploadMetaDto } from './dto/media.dto';
import { OperationLogService } from '../logs/operation-log.service';

const MAX_UPLOAD_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 500 * 1024 * 1024); // 500MB

@Controller('media')
export class MediaController {
  private readonly log = new Logger(MediaController.name);

  constructor(
    private readonly media: MediaService,
    private readonly opLog: OperationLogService,
  ) {}

  @Post('upload')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          // 通过 service 拿 tmp 路径 — 但 storage 工厂里没注入, 用 env 拷一份
          const root = process.env.MEDIA_ROOT
            || (process.platform === 'win32' ? 'D:\\Media' : '/var/lib/smart-control/media');
          const tmp = join(root, '_tmp');
          mkdirSync(tmp, { recursive: true });
          cb(null, tmp);
        },
        filename: (_req, file, cb) => {
          const ts = Date.now().toString(36);
          const rand = Math.random().toString(36).slice(2, 8);
          cb(null, `${ts}-${rand}${extname(file.originalname).toLowerCase()}`);
        },
      }),
      limits: { fileSize: MAX_UPLOAD_BYTES },
      fileFilter: (_req, file, cb) => {
        if (file.mimetype.startsWith('video/') || file.mimetype.startsWith('image/')) {
          cb(null, true);
        } else {
          cb(new Error(`不支持的文件类型 ${file.mimetype}, 仅支持 video/* 和 image/*`), false);
        }
      },
    }),
  )
  async upload(
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: MediaUploadMetaDto,
  ) {
    if (!file) {
      return { message: '未收到文件', data: null };
    }
    const asset = await this.media.ingest(file, 'system', meta.remark);
    await this.opLog.record({
      operator: 'system',
      action: 'media.upload',
      targetType: 'media',
      targetId: String(asset.id),
      result: 'success',
      message: JSON.stringify({
        name: asset.originalName,
        kind: asset.kind,
        size: asset.sizeBytes,
        mime: asset.mimeType,
      }),
    });
    return { message: '上传成功', data: this.media.toListItem(asset) };
  }

  @Get()
  async list(
    @Query('kind') kind?: 'video' | 'image',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const l = limit ? Math.max(1, Math.min(200, Number(limit))) : 200;
    const o = offset ? Math.max(0, Number(offset)) : 0;
    const result = await this.media.list({ kind, limit: l, offset: o });
    return { message: 'ok', data: result };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const m = await this.media.get(id);
    return { message: 'ok', data: this.media.toListItem(m) };
  }

  @Get(':id/file')
  async file(@Param('id', ParseIntPipe) id: number, @Res() res: Response): Promise<void> {
    const { stream, mimeType, size, filename } = await this.media.openStream(id);
    res.setHeader('Content-Type', mimeType);
    res.setHeader('Content-Length', size);
    // 支持浏览器内嵌播放 (不强制下载)
    res.setHeader('Content-Disposition', `inline; filename="${encodeURIComponent(filename)}"`);
    res.setHeader('Accept-Ranges', 'bytes');
    stream.pipe(res);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number) {
    const r = await this.media.remove(id);
    await this.opLog.record({
      operator: 'system',
      action: 'media.delete',
      targetType: 'media',
      targetId: String(id),
      result: 'success',
      message: JSON.stringify({ id }),
    });
    return { message: '已删除', data: r };
  }

  /**
   * 推送到 LED 大屏 — 在 GK9000 本机用全屏播放器打开
   *
   * 走法 (现场): GK9000 HDMI1 → 诺瓦 VX1000 → LED 大屏
   * 播放器优先级: env MEDIA_PLAYER > PotPlayer > VLC > 系统默认 (start)
   *
   * 仅 Windows + 同主机有效. 远程主机要播放需要 RDP/HDMI 实体接显示器.
   */
  @Post(':id/publish')
  async publish(@Param('id', ParseIntPipe) id: number) {
    const m = await this.media.get(id);
    const playerEnv = process.env.MEDIA_PLAYER;
    let cmd: string;
    let args: string[];

    if (playerEnv) {
      cmd = playerEnv;
      args = ['/fullscreen', m.path];
    } else if (process.platform === 'win32') {
      // 默认: 用 Windows 自带 start 调系统关联程序 (Photos / Movies & TV)
      // 后续可装 PotPlayer 切到它. start 是 cmd 内建, 必须 shell:true
      cmd = 'cmd';
      args = ['/c', 'start', '""', m.path];
    } else {
      cmd = 'xdg-open';
      args = [m.path];
    }

    try {
      const child = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: false });
      child.unref();
      await this.media.markPlayed(id);
      await this.opLog.record({
        operator: 'system',
        action: 'media.publish',
        targetType: 'media',
        targetId: String(id),
        result: 'success',
        message: JSON.stringify({ name: m.originalName, cmd, args }),
      });
      this.log.log(`Published media id=${id} via ${cmd} ${args.join(' ')}`);
      return {
        message: '已发起播放',
        data: { id, name: m.originalName, player: cmd, args },
      };
    } catch (e) {
      const err = e as Error;
      await this.opLog.record({
        operator: 'system',
        action: 'media.publish',
        targetType: 'media',
        targetId: String(id),
        result: 'failure',
        message: err.message,
      });
      return { message: `播放失败: ${err.message}`, data: null };
    }
  }
}
