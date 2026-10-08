import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { promises as fs } from 'fs';
import { join, resolve, relative, sep, dirname } from 'path';
import Jimp from 'jimp';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaService } from './media.service';

/**
 * 服务端缩略图 (2026-10-07)。
 *
 * 背景: 欢迎页编辑器的图片选择列表此前必须先下载完整原图 (背景最大 3612x1462),
 * 再在浏览器里本地缩放, 公网/移动网络下首屏很慢。后端此前没有任何缩略图能力
 * (thumbPath 恒为 null, controller 也把 thumbUrl 强制置空)。本服务用纯 JS 的
 * jimp (无原生依赖, Windows 易部署):
 *   - 新图上传后由 controller fire-and-forget 主动生成;
 *   - 历史图片在首次 GET /api/media/:id/thumb 时 lazy 生成并落盘;
 * 生成一次后长期复用, 列表只拉 ~480px 小图, 零原图下载。
 * 缩略图失败不影响原图与上传主流程。
 */
export const THUMB_MAX_DIMENSION = 480;
const THUMB_JPEG_QUALITY = 82;
const THUMB_FILE_JPEG = 'thumb.jpg';
const THUMB_FILE_PNG = 'thumb.png';

export interface MediaThumbnail {
  absPath: string;
  mimeType: string;
}

@Injectable()
export class MediaThumbnailService {
  private readonly generating = new Map<number, Promise<MediaThumbnail>>();

  constructor(
    @InjectRepository(MediaAsset)
    private readonly repo: Repository<MediaAsset>,
    private readonly media: MediaService,
  ) {}

  /** 返回缩略图; 已存在直接复用, 否则 lazy 生成 (同 id 并发去重)。 */
  ensureThumbnail(id: number): Promise<MediaThumbnail> {
    const active = this.generating.get(id);
    if (active) return active;
    const job = this.resolveThumbnail(id).finally(() => this.generating.delete(id));
    this.generating.set(id, job);
    return job;
  }

  /** webp 原图 → Jimp（@jsquash 纯 wasm 解码，无原生依赖）。 */
  private async fromWebp(buffer: Buffer): Promise<Jimp> {
    const decode = await loadWebpDecoder();
    const result = await decode(buffer);
    const img = new Jimp(result.width, result.height);
    img.bitmap.data.set(result.data);
    return img;
  }

  private async resolveThumbnail(id: number): Promise<MediaThumbnail> {
    const asset = await this.media.get(id);
    if (asset.kind !== 'image') throw new BadRequestException('仅图片可生成缩略图');

    const root = resolve(this.media.mediaRoot);
    if (asset.thumbPath) {
      const existing = resolve(root, asset.thumbPath);
      try {
        const stat = await fs.stat(existing);
        if (stat.isFile()) {
          return { absPath: existing, mimeType: mimeFromThumbPath(asset.thumbPath) };
        }
      } catch {
        // 落盘文件缺失 → 落到下面重建
      }
    }

    const source = resolve(asset.path);
    const sourceStat = await fs.stat(source);
    if (!sourceStat.isFile()) throw new BadRequestException('原图不存在');

    const sourceBuffer = await fs.readFile(source);
    // jimp 0.22 无内置 webp 解码：webp 走纯 wasm 的 @jsquash 解码为 RGBA 再构造 Jimp；
    // jpeg/png 等直接由 jimp 读取。
    const img =
      asset.mimeType === 'image/webp'
        ? await this.fromWebp(sourceBuffer)
        : await Jimp.read(sourceBuffer);
    // 只缩不放: 小图保持原尺寸, 避免无意义放大与模糊。
    const longest = Math.max(img.bitmap.width, img.bitmap.height);
    if (longest > THUMB_MAX_DIMENSION) {
      img.scale(THUMB_MAX_DIMENSION / longest);
    }

    // PNG 保留透明通道 (logo/图标); 其余统一转 JPEG 以减小体积。
    const keepPng = asset.mimeType === 'image/png';
    const outMime = keepPng ? Jimp.MIME_PNG : Jimp.MIME_JPEG;
    const outBuf = keepPng
      ? await img.getBufferAsync(Jimp.MIME_PNG)
      : await img.quality(THUMB_JPEG_QUALITY).getBufferAsync(Jimp.MIME_JPEG);

    // 与原图同目录 (<root>/<id>/ 或 <root>/welcome-photos/<id>/)。
    const outPath = join(dirname(source), keepPng ? THUMB_FILE_PNG : THUMB_FILE_JPEG);
    await fs.writeFile(outPath, outBuf);

    const rel = relative(root, outPath).split(sep).join('/');
    await this.repo.update(id, { thumbPath: rel });
    return { absPath: outPath, mimeType: outMime };
  }
}

function mimeFromThumbPath(rel: string): string {
  return rel.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
}

/** @jsquash/webp 为 ESM-only；懒加载并手动喂本地 wasm（Node 下其默认 fetch(file:) 不可用）。 */
type WebpDecode = (
  buffer: Buffer,
) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
let webpDecoderPromise: Promise<WebpDecode> | undefined;
function loadWebpDecoder(): Promise<WebpDecode> {
  if (!webpDecoderPromise) {
    webpDecoderPromise = (async () => {
      // TS 在 module:commonjs 下会把 await import() 降级为 require()，而
      // @jsquash 是 ESM-only；用 Function 构造器保留运行时真正的动态 import()。
      const esmImport = new Function('specifier', 'return import(specifier);') as (
        specifier: string,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ) => Promise<any>;
      const mod = await esmImport('@jsquash/webp/decode.js');
      const wasmPath = require.resolve('@jsquash/webp/codec/dec/webp_dec.wasm');
      const wasmModule = await WebAssembly.compile(await fs.readFile(wasmPath));
      await mod.init(wasmModule);
      return mod.default as WebpDecode;
    })();
  }
  return webpDecoderPromise;
}
