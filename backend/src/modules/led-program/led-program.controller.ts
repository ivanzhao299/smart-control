import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthenticatedRequest, requireActor } from '../../common/auth/actor';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { RateLimit, RateLimitGuard } from '../../common/guards/rate-limit.guard';
import { LedProgramService, IngestMeta, SegmentInput } from './led-program.service';

/**
 * LED 节目制作接口：
 *  - POST /api/led-program/ingest   浏览器端真生成 bin → multipart 上传 → 存盘入库（不自动推流）
 *  - POST /api/led-program/:id/push 后端按 id 把已存 bin 转发 PVE /push
 *  - GET  /api/led-program/status  PVE receiver 连通探活（3s 超时）
 *  - GET  /api/led-program/history 最近节目登记（含段快照）
 *
 * 权限：led-program:view 可看/探活/历史；ingest 与 push 是写操作，要求 led-program:control。
 * 功能未完全上线，暂仅 admin（admin 自动拥有全部权限，其他角色需手动授权）。
 */
@Controller('led-program')
@UseGuards(RateLimitGuard)
export class LedProgramController {
  constructor(private readonly svc: LedProgramService) {}

  @Post('ingest')
  @RequirePermission('led-program:control')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 256 * 1024 * 1024 } }))
  @RateLimit({ max: 6, windowMs: 60_000 })
  async ingest(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
    @Body('meta') metaRaw?: string,
  ) {
    const actor = requireActor(req);
    let meta: IngestMeta = { name: file?.originalname ?? 'program' };
    if (metaRaw) {
      try {
        const parsed = JSON.parse(metaRaw) as Partial<IngestMeta>;
        meta = { ...meta, ...parsed };
        if (Array.isArray(parsed.segments)) {
          meta.segments = parsed.segments as SegmentInput[];
        }
      } catch {
        // meta 不是合法 JSON 时按空元数据处理，bin 仍然入库
      }
    }
    const result = await this.svc.ingest(file, meta, actor);
    return { message: 'bin 已入库', data: result };
  }

  @Post(':id/push')
  @RequirePermission('led-program:control')
  @RateLimit({ max: 10, windowMs: 10_000 })
  async push(@Param('id', ParseIntPipe) id: number) {
    const r = await this.svc.push(id);
    return { message: r.ok ? '推流已触发' : '推流失败', data: r };
  }

  @Get('status')
  @RequirePermission('led-program:view')
  async status() {
    const r = await this.svc.status();
    return { message: '查询成功', data: r };
  }

  @Get('history')
  @RequirePermission('led-program:view')
  async history() {
    const list = await this.svc.history(50);
    return { message: '查询成功', data: list };
  }
}
