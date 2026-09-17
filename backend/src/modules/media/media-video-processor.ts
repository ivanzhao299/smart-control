import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join, resolve, extname } from 'path';
import { randomUUID } from 'crypto';
import { Logger } from 'winston';
import { MediaAsset } from '../../entities/media-asset.entity';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { MediaQuotaService } from './media-quota.service';
import type { MediaVideoTools } from './media-video-tools';

interface VideoProcessorOptions {
  repo: Repository<MediaAsset>;
  mediaRoot: () => string;
  logger: Logger;
  tools: MediaVideoTools;
  acquireOperation: (id: number) => () => void;
  updateFields: (id: number, fields: Partial<MediaAsset>) => Promise<void>;
}

/** Owns video preparation and compensation; no dependency on the catalog facade or controllers. */
export class MediaVideoProcessor {
  private readonly preparing = new Set<number>();
  constructor(private readonly options: VideoProcessorOptions) {}
  isPreparing(id: number): boolean {
    return this.preparing.has(id);
  }

  /** 探测真实编码；浏览器不稳播的格式生成 H.264/AAC MP4 播放副本。 */
  async prepare(id: number): Promise<void> {
    if (this.preparing.has(id)) return;
    const release = this.options.acquireOperation(id);
    this.preparing.add(id);
    let conversionTemp: string | undefined;
    let conversionReservation: { id: string | null; bytes: number } | undefined;
    let outputInstalled = false;
    let outputAccounted = false;
    const quota = new MediaQuotaService(this.options.repo.manager.connection);
    try {
      const media = await serializedTransaction(
        this.options.repo.manager.connection,
        async (manager) => {
          const current = await manager.findOneBy(MediaAsset, { id });
          if (!current) throw new NotFoundException('资料不存在');
          if (current.kind !== 'video') throw new BadRequestException('只有视频需要转码');
          await manager.update(MediaAsset, id, {
            processingStatus: 'processing',
            processingError: null,
          });
          return current;
        },
      );

      const source = media.sourcePath || media.path;
      const probe = await this.options.tools.probe(source);
      media.durationSec = probe.duration ? Math.round(probe.duration) : media.durationSec;
      media.resolution =
        probe.width && probe.height ? `${probe.width}x${probe.height}` : media.resolution;
      const ext = extname(source).toLowerCase();
      const browserReady =
        ext === '.mp4' &&
        probe.videoCodec === 'h264' &&
        (!probe.audioCodec || probe.audioCodec === 'aac' || probe.audioCodec === 'mp3');
      if (browserReady) {
        media.mimeType = 'video/mp4';
        media.processingStatus = 'ready';
        await this.options.updateFields(id, {
          mimeType: media.mimeType,
          processingStatus: 'ready',
          durationSec: media.durationSec,
          resolution: media.resolution,
        });
        return;
      }

      const dir = join(this.options.mediaRoot(), String(media.id));
      conversionReservation = await quota.reserveConversion(
        id,
        media.ownerUserId,
        Number(process.env.MEDIA_TRANSCODE_MAX_BYTES ?? 10 * 1024 ** 3),
        this.options.mediaRoot(),
      );
      const temp = join(dir, `playback-converting-${randomUUID()}.mp4`);
      conversionTemp = temp;
      // An uploaded original may itself be named playback.mp4. Never replace it.
      const output = join(
        dir,
        resolve(source) === resolve(dir, 'playback.mp4') ? 'playback-derived.mp4' : 'playback.mp4',
      );
      await this.options.tools.transcode(
        [
          '-i',
          source,
          '-map',
          '0:v:0',
          '-map',
          '0:a?',
          '-c:v',
          'libx264',
          '-preset',
          'medium',
          '-crf',
          '20',
          '-pix_fmt',
          'yuv420p',
          '-c:a',
          'aac',
          '-b:a',
          '192k',
          '-movflags',
          '+frag_keyframe+empty_moov',
          '-f',
          'mp4',
          'pipe:1',
        ],
        temp,
        conversionReservation.bytes,
      );
      await fs.rename(temp, output);
      outputInstalled = true;
      media.sourcePath = source;
      media.path = output;
      media.mimeType = 'video/mp4';
      const retainedPaths = new Set(
        [source, output, media.thumbPath, media.docPdfPath]
          .filter((value): value is string => !!value)
          .map((value) => resolve(this.options.mediaRoot(), value)),
      );
      let retainedBytes = 0;
      for (const file of retainedPaths) {
        const stat = await fs.stat(file);
        if (!stat.isFile()) throw new Error('媒体存储路径不是文件');
        retainedBytes += stat.size;
        if (!Number.isSafeInteger(retainedBytes)) throw new Error('媒体存储大小超出安全范围');
      }
      media.sizeBytes = retainedBytes;
      media.processingStatus = 'ready';
      media.processingError = null;
      await this.options.updateFields(id, {
        sourcePath: media.sourcePath,
        path: media.path,
        mimeType: media.mimeType,
        sizeBytes: media.sizeBytes,
        processingStatus: 'ready',
        processingError: null,
        durationSec: media.durationSec,
        resolution: media.resolution,
      });
      outputAccounted = true;
      this.options.logger.info(`[Media] 视频 #${id} 已转为 H.264/AAC 播放副本`, {
        context: 'MediaService',
      });
    } catch (error) {
      // Exclusive creation failed: this path was not created by this attempt.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') conversionTemp = undefined;
      const message = (error as Error).message.slice(0, 1000);
      await this.options
        .updateFields(id, { processingStatus: 'failed', processingError: message })
        .catch(() => {});
      this.options.logger.error(`[Media] 视频 #${id} 兼容处理失败: ${message}`, {
        context: 'MediaService',
      });
    } finally {
      let cleanupComplete = true;
      if (conversionTemp) {
        await fs.unlink(conversionTemp).catch((error) => {
          if (error.code !== 'ENOENT') {
            cleanupComplete = false;
            this.options.logger.error(`[Media] 视频 #${id} 临时转码文件清理失败，保留待恢复`, {
              context: 'MediaService',
            });
          }
        });
      }
      if (conversionReservation && cleanupComplete && (!outputInstalled || outputAccounted)) {
        await quota.releaseConversion(conversionReservation.id, id).catch(() => {
          this.options.logger.error(`[Media] 视频 #${id} 转码预留释放失败，保留待恢复`, {
            context: 'MediaService',
          });
        });
      }
      this.preparing.delete(id);
      release();
    }
  }
}
