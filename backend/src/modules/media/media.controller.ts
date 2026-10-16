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
  HttpCode,
  Req,
  UseGuards,
  Put,
} from '@nestjs/common';
import { QuotaUploadInterceptor } from './quota-upload.interceptor';
import type { Response } from 'express';
// (Sprint-10: spawn 用于旧 publish 路径, 已下架)
import { MediaService } from './media.service';
import { ImportOrphanDto, MediaUploadMetaDto, WebpageCreateDto, UpdateMediaDto } from './dto/media.dto';
import { OperationLogService } from '../logs/operation-log.service';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { ActorAdminGuard } from '../../common/guards/actor-admin.guard';
import { assertCanUpload } from '../../common/auth/resource-policy';
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { MediaAccessService } from './media-access.service';
import { MediaQuotaService } from './media-quota.service';
import { MediaThumbnailService } from './media-thumbnail.service';
import { Public } from '../../common/decorators/public.decorator';
import { ReadOnlyRequest } from '../../common/decorators/read-only-request.decorator';
import { sendMediaFile } from '../../common/utils/send-media-file';

/** Runs before Multer so denied callers cannot fill the temporary disk. */
@Injectable()
class MediaUploadGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    assertCanUpload(requireActor(ctx.switchToHttp().getRequest()));
    return true;
  }
}

/** 高清视频 4K 60fps 30 分钟 ≈ 10GB, 默认放到 10GB. env MEDIA_MAX_BYTES 可调 */

@Controller('media')
export class MediaController {
  private readonly log = new Logger(MediaController.name);

  constructor(
    private readonly media: MediaService,
    private readonly opLog: OperationLogService,
    private readonly access: MediaAccessService,
    private readonly quota: MediaQuotaService,
    private readonly thumbnails: MediaThumbnailService,
  ) {}

  @Get('storage/me')
  async storage(@Req() req: AuthenticatedRequest) {
    return { message: 'ok', data: await this.quota.usage(requireActor(req)) };
  }

  @Put('storage/users/:id')
  @UseGuards(ActorAdminGuard)
  async setQuota(@Req() req: AuthenticatedRequest, @Param('id', ParseIntPipe) id: number, @Body() body: { quotaBytes?: number }) {
    const actor = requireActor(req);
    await this.quota.setLimit(actor, id, body?.quotaBytes as number);
    await this.opLog.record({ operator: actor.username, action: 'user.storage-quota', targetType: 'user', targetId: String(id), message: `quotaBytes=${body.quotaBytes}` });
    return { message: '配额已更新', data: null };
  }

  @Post('upload')
  @UseGuards(MediaUploadGuard)
  @UseInterceptors(QuotaUploadInterceptor)
  async upload(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body() meta: MediaUploadMetaDto,
  ) {
    if (!file) {
      return { message: '未收到文件', data: null };
    }
    const actor = requireActor(req);
    const asset = await this.media.ingest(file, actor.username, meta.remark, actor,
      (req as AuthenticatedRequest & { uploadReservationId?: string | null }).uploadReservationId);
    await this.opLog.record({
      operator: actor.username,
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
    if (asset.kind === 'image') this.scheduleThumbnail(asset.id);
    return { message: '上传成功', data: this.media.toListItem(asset) };
  }

  /** 添加一个网页 URL 作为"媒体" — 可像视频/图片一样推送到 LED/投影 */
  @Post('webpage')
  @UseGuards(MediaUploadGuard)
  async createWebpage(@Body() dto: WebpageCreateDto, @Req() req: AuthenticatedRequest) {
    const actor = requireActor(req);
    const asset = await this.media.createWebpage(dto.name, dto.url, actor);
    await this.opLog.record({
      operator: actor.username,
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
    @Req() req: AuthenticatedRequest,
    @Query('kind') kind?: 'video' | 'image' | 'audio' | 'webpage' | 'doc',
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('scope') scope?: 'visible' | 'mine' | 'shared',
    @Query('keyword') keyword?: string,
    @Query('ownerUserId') ownerUserId?: string,
  ) {
    const l = limit ? Math.max(1, Math.min(200, Number(limit))) : 200;
    const o = offset ? Math.max(0, Number(offset)) : 0;
    const result = await this.media.list({ kind, limit: l, offset: o, actor: requireActor(req), scope, keyword, ownerUserId: ownerUserId === undefined ? undefined : Number(ownerUserId) });
    for (const item of result.items) {
      if (item.kind !== 'webpage') {
        item.fileUrl = (await this.access.issue(req, item.id, 'file')).url;
        // thumbUrl 由 toListItem 统一签发 (/api/media/:id/thumb), 端点按需 lazy 生成。
      }
    }
    return { message: 'ok', data: result };
  }

  /**
   * 扫描 media 目录里数据库还不认识的文件 (业主直接 RDP 进服务器拷进来的, 没走上传接口)。
   * 路由必须排在 :id 前面, 否则 "orphans" 会被当成 :id 解析。
   */
  @Get('orphans')
  @UseGuards(ActorAdminGuard)
  async orphans() {
    const items = await this.media.scanOrphans();
    return { message: 'ok', data: items };
  }

  @Get('tools/status')
  @UseGuards(ActorAdminGuard)
  async mediaTools() {
    return { message: 'ok', data: await this.media.mediaToolStatus() };
  }

  /** 收编 scanOrphans() 列出的某个文件, 正式变成媒体库资源 */
  @Post('orphans/import')
  @UseGuards(ActorAdminGuard)
  async importOrphan(@Req() req: AuthenticatedRequest, @Body() dto: ImportOrphanDto) {
    const actor = requireActor(req);
    const asset = await this.media.importOrphan(dto.relPath, actor.username, actor, dto.remark);
    await this.opLog.record({
      operator: actor.username,
      action: 'media.orphan.import',
      targetType: 'media',
      targetId: String(asset.id),
      result: 'success',
      message: JSON.stringify({ name: asset.originalName, kind: asset.kind, relPath: dto.relPath }),
    });
    if (asset.kind === 'image') this.scheduleThumbnail(asset.id);
    return { message: '已收编到媒体库', data: this.media.toListItem(asset) };
  }

  @Get(':id')
  async detail(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    const m = await this.media.authorized(id, requireActor(req));
    return { message: 'ok', data: this.media.toListItem(m) };
  }

  @Put(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest, @Body() dto: UpdateMediaDto) {
    const actor = requireActor(req);
    const media = await this.media.updateOwned(id, actor, dto);
    await this.opLog.record({ operator: actor.username, action: 'media.update', targetType: 'media', targetId: String(id), message: JSON.stringify({ userId: actor.userId, ...dto }) });
    return { message: '已更新', data: this.media.toListItem(media) };
  }

  @Post(':id/access')
  @ReadOnlyRequest()
  async issueAccess(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest,
    @Body() body: { variant?: string } = {}) {
    return { message: 'ok', data: await this.access.issue(req, id, body.variant === 'pdf' ? 'pdf' : 'file') };
  }

  @Public()
  @Get(':id/stream')
  async stream(@Param('id', ParseIntPipe) id: number, @Query('ticket') ticket: string,
    @Res() res: Response, @Req() req: AuthenticatedRequest): Promise<void> {
    const file = await this.access.open(ticket, id, req.headers.range);
    this.sendFile(res, file);
  }

  private sendFile(res: Response, file: Awaited<ReturnType<MediaService['openStream']>>): void {
    sendMediaFile(res, file);
  }

  /** 上传/收编后后台预生成缩略图; 失败不影响原图与主流程。 */
  private scheduleThumbnail(id: number): void {
    void this.thumbnails
      .ensureThumbnail(id)
      .catch(error => this.log.warn(`[Media] 缩略图预生成失败 #${id}: ${(error as Error).message}`));
  }

  @Get(':id/file')
  async file(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseIntPipe) id: number,
    @Res() res: Response,
    @Query('variant') variant?: string,
  ): Promise<void> {
    this.sendFile(res, await this.access.openDirect(req, id, variant === 'pdf', req.headers.range));
  }

  /** 缩略图: 已生成直接发, 历史图首次访问 lazy 生成; 稳定 URL, 靠浏览器缓存二次秒显。 */
  @Get(':id/thumb')
  async thumb(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ): Promise<void> {
    await this.media.authorized(id, requireActor(req));
    const t = await this.thumbnails.ensureThumbnail(id);
    res.setHeader('Content-Type', t.mimeType);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(t.absPath);
  }

  @Delete(':id')
  async remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    const actor = requireActor(req);
    const r = await this.media.remove(id, actor);
    await this.opLog.record({
      operator: actor.username,
      action: 'media.delete',
      targetType: 'media',
      targetId: String(id),
      result: 'success',
      message: JSON.stringify({ id, cleanupPending: r.cleanupPending }),
    });
    return { message: r.cleanupPending ? '已删除资料记录，隔离文件待管理员清理' : '已删除', data: r };
  }

  // 注: 旧的 POST /api/media/:id/publish (spawn 系统播放器) 在 Sprint-10 已下架.
  // 新链路: 前端调 POST /api/playback/channels/:slot/publish { mediaId },
  //   PlaybackService 写 channel 状态 + WS 广播, PlayerPage (Chromium kiosk
  //   全屏占住 HDMI1/HDMI2) 收到 WS 事件直接 <video src=/api/media/N/file>.
  // 整套不再依赖 Windows 默认关联程序, 切换无延迟, 双路独立.
  /** 放映守护专用: 文档的磁盘绝对路径等 (本机进程用, 与其他接口同鉴权口径) */
  @Get(':id/doc-info')
  @UseGuards(ActorAdminGuard)
  async docInfo(@Param('id', ParseIntPipe) id: number) {
    const a = await this.media.get(id);
    return {
      message: 'ok',
      data: {
        id: a.id,
        kind: a.kind,
        originalName: a.originalName,
        absPath: this.media.absPathOf(a),
        ext: (a.safeName.split('.').pop() || '').toLowerCase(),
        pageCount: a.pageCount,
        docPdfPath: a.docPdfPath,
      },
    };
  }

  /** 放映守护回写: 页数 / Word 转出 PDF 相对路径 */
  @Post(':id/doc-meta')
  @UseGuards(ActorAdminGuard)
  @HttpCode(200)
  async docMeta(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: AuthenticatedRequest,
    @Body() body: { pageCount?: number; pdfRelPath?: string } = {},
  ) {
    const a = await this.media.setDocMeta(id, body, requireActor(req));
    return { message: 'ok', data: { id: a.id, pageCount: a.pageCount, docPdfPath: a.docPdfPath } };
  }

  /** 对存量视频手动补做兼容转码；立即返回，进度通过媒体列表查看。 */
  @Post(':id/prepare')
  @HttpCode(202)
  async prepare(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    await this.media.authorized(id, requireActor(req), true);
    void this.media.prepareVideo(id);
    return { message: '兼容处理已开始', data: { id } };
  }

}
