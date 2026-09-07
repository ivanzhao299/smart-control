import { Injectable, NestInterceptor, ExecutionContext, CallHandler, BadRequestException } from '@nestjs/common';
import { defer, lastValueFrom } from 'rxjs';
import multer = require('multer');
import { randomUUID } from 'crypto';
import { promises as fs, createWriteStream } from 'fs';
import { join } from 'path';
import { requireActor } from '../../common/auth/actor';
import { MediaQuotaService } from './media-quota.service';
import { MediaService } from './media.service';

/** Reserve before reading multipart data; enforce the declared size while streaming. */
@Injectable()
export class QuotaUploadInterceptor implements NestInterceptor {
  constructor(private readonly quota: MediaQuotaService, private readonly media: MediaService) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    return defer(async () => {
      const req = context.switchToHttp().getRequest();
      const res = context.switchToHttp().getResponse();
      const actor = requireActor(req);
      const header = req.headers['x-upload-size'];
      const bytes = typeof header === 'string' && /^\d+$/.test(header) ? Number(header) : NaN;
      const maximum = Number(process.env.MEDIA_MAX_BYTES ?? 10 * 1024 ** 3);
      if (!Number.isSafeInteger(bytes) || bytes < 1 || !Number.isSafeInteger(maximum) || bytes > maximum) throw new BadRequestException('请提供有效的X-Upload-Size文件大小');
      const reservation = await this.quota.reserve(actor, bytes);
      req.uploadReservationId = reservation;
      let path: string | undefined;
      let writing: Promise<void> = Promise.resolve();
      try {
        const directory = join(this.media.mediaRoot, '_tmp');
        await fs.mkdir(directory, { recursive: true });
        const directoryStat = await fs.lstat(directory);
        const [realRoot, realDirectory] = await Promise.all([fs.realpath(this.media.mediaRoot), fs.realpath(directory)]);
        if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink() || realDirectory !== join(realRoot, '_tmp')) {
          throw new BadRequestException('上传临时目录不安全，请管理员检查');
        }
        const filename = randomUUID() + '.upload';
        // Persist exact ownership before any file handle can be opened.
        await this.quota.bindTemporary(actor, reservation, filename);
        if (req.aborted || req.destroyed) throw new BadRequestException('上传连接已断开');
        const parser = multer({
          storage: {
            _handleFile: (_req, file, cb) => {
              const target = join(directory, filename);
              path = target;
              const output = createWriteStream(target, { flags: 'wx' });
              let failure: Error | undefined;
              let sourceFailed = false;
              // Stop consuming input, flush buffered bytes and close the handle.
              // Multer's request error waits for this storage callback before cleanup.
              const abort = () => { file.stream.unpipe(output); output.end(); };
              const sourceError = () => { sourceFailed = true; abort(); };
              file.stream.once('error', sourceError);
              req.once('aborted', abort);
              output.on('error', error => { failure = error; });
              writing = new Promise<void>(resolve => output.once('close', () => {
                req.removeListener('aborted', abort);
                file.stream.removeListener('error', sourceError);
                resolve();
                // Multer already decrements its pending counter on file-stream error.
                if (!sourceFailed) cb(failure ?? null, { destination: directory, filename, path: target, size: output.bytesWritten });
              }));
              file.stream.pipe(output);
              if (req.aborted) abort();
            },
            _removeFile: (_req, file, cb) => {
              fs.unlink(file.path).then(() => cb(null), error => cb(error.code === 'ENOENT' ? null : error));
            },
          },
          // Busboy signals limit when reaching the threshold, including an exact-size file.
          // One sentinel byte distinguishes a valid exact-size upload; never ingest excess.
          limits: { fileSize: bytes + 1, files: 1, fields: 5, fieldSize: 16 * 1024 },
          fileFilter: (_req, file, cb) => {
            if (!this.media.classifyKind(file.mimetype, file.originalname)) return cb(new BadRequestException('不支持的文件类型'));
            cb(null, true);
          },
        }).single('file');
        await new Promise<void>((resolve, reject) => parser(req, res, error => error ? reject(new BadRequestException('上传失败：文件过大或请求格式无效')) : resolve()));
        if (req.aborted) throw new BadRequestException('上传连接已断开');
        if (!req.file || req.file.size !== bytes) throw new BadRequestException('实际文件大小与声明不一致');
        return await lastValueFrom(next.handle());
      } finally {
        await writing;
        // The normal ingest moves this exact temp file. Do not delete final assets.
        if (path) await fs.unlink(path).catch(error => { if (error.code !== 'ENOENT') throw error; });
        await this.quota.release(actor, reservation);
      }
    });
  }
}
