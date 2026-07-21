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
// (Sprint-10: spawn 用于旧 publish 路径, 已下架)
import { MediaService } from './media.service';
import { ImportOrphanDto, MediaUploadMetaDto, WebpageCreateDto } from './dto/media.dto';
import { OperationLogService } from '../logs/operation-log.service';
import { Public } from '../../common/decorators/public.decorator';

/** 高清视频 4K 60fps 30 分钟 ≈ 10GB, 默认放到 10GB. env MEDIA_MAX_BYTES 可调 */
const MAX_UPLOAD_BYTES = Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 * 1024 * 1024);

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
        const m = file.mimetype;
        const name = (file.originalname || '').toLowerCase();
        const audioExt = [
          '.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac', '.wma',
          '.opus', '.aiff', '.aif', '.ape', '.mp2', '.mka', '.wv',
          '.mid', '.midi', '.spx', '.dsf', '.dff', '.au', '.ra',
        ];
        if (
          m.startsWith('video/') || m.startsWith('image/') || m.startsWith('audio/')
          || audioExt.some((ext) => name.endsWith(ext))  // m4a/aac mime 有时不带 audio/
        ) {
          cb(null, true);
        } else {
          cb(new Error(`不支持的文件类型 ${file.mimetype}, 仅支持 video/* 图片 音频`), false);
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

  /** 添加一个网页 URL 作为"媒体" — 可像视频/图片一样推送到 LED/投影 */
  @Post('webpage')
  async createWebpage(@Body() dto: WebpageCreateDto) {
    const asset = await this.media.createWebpage(dto.name, dto.url);
    await this.opLog.record({
      operator: 'system',
      action: 'media.webpage.create',
      targetType: 'media',
      targetId: String(asset.id),
      result: 'success',
      message: JSON.stringify({ name: asset.originalName, url: asset.sourceUrl }),
    });
    return { message: '已添加网页', data: this.media.toListItem(asset) };
  }

  @Get()
  async list(
    @Query('kind') kind?: 'video' | 'image' | 'audio',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const l = limit ? Math.max(1, Math.min(200, Number(limit))) : 200;
    const o = offset ? Math.max(0, Number(offset)) : 0;
    const result = await this.media.list({ kind, limit: l, offset: o });
    return { message: 'ok', data: result };
  }

  /**
   * 扫描 media 目录里数据库还不认识的文件 (业主直接 RDP 进服务器拷进来的, 没走上传接口)。
   * 路由必须排在 :id 前面, 否则 "orphans" 会被当成 :id 解析。
   */
  @Get('orphans')
  async orphans() {
    const items = await this.media.scanOrphans();
    return { message: 'ok', data: items };
  }

  /** 收编 scanOrphans() 列出的某个文件, 正式变成媒体库资源 */
  @Post('orphans/import')
  async importOrphan(@Body() dto: ImportOrphanDto) {
    const asset = await this.media.importOrphan(dto.relPath, 'system', dto.remark);
    await this.opLog.record({
      operator: 'system',
      action: 'media.orphan.import',
      targetType: 'media',
      targetId: String(asset.id),
      result: 'success',
      message: JSON.stringify({ name: asset.originalName, kind: asset.kind, relPath: dto.relPath }),
    });
    return { message: '已收编到媒体库', data: this.media.toListItem(asset) };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number) {
    const m = await this.media.get(id);
    return { message: 'ok', data: this.media.toListItem(m) };
  }

  @Public()
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

  // 注: 旧的 POST /api/media/:id/publish (spawn 系统播放器) 在 Sprint-10 已下架.
  // 新链路: 前端调 POST /api/playback/channels/:slot/publish { mediaId },
  //   PlaybackService 写 channel 状态 + WS 广播, PlayerPage (Chromium kiosk
  //   全屏占住 HDMI1/HDMI2) 收到 WS 事件直接 <video src=/api/media/N/file>.
  // 整套不再依赖 Windows 默认关联程序, 切换无延迟, 双路独立.
}
