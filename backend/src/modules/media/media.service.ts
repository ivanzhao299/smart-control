import { BadRequestException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { Repository } from 'typeorm';
import { promises as fs, createReadStream, ReadStream, statSync } from 'fs';
import { join, resolve, relative, basename, extname, sep } from 'path';
import { MediaAsset, MediaKind } from '../../entities/media-asset.entity';
import { MediaListItem, OrphanMediaItem } from './dto/media.dto';

const VIDEO_MIME_PREFIXES = ['video/'];
const IMAGE_MIME_PREFIXES = ['image/'];
const AUDIO_MIME_PREFIXES = ['audio/'];
// 有些浏览器/系统对音频给的 mime 不带 audio/ 前缀 (如 Windows 对 .ape/.flac 报 application/octet-stream), 用扩展名兜底
// 文档投屏 (2026-07-25): PPT 原生放映保动画, Word 转 PDF 逐页
const DOC_EXT = ['.ppt', '.pptx', '.doc', '.docx'];
const DOC_MIME = [
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
];
const AUDIO_EXT = [
  '.mp3', '.wav', '.aac', '.m4a', '.ogg', '.flac', '.wma',
  '.opus', '.aiff', '.aif', '.ape', '.mp2', '.mka', '.wv',
  '.mid', '.midi', '.spx', '.dsf', '.dff', '.au', '.ra',
];

/**
 * 扫描磁盘用 —— 上传走的是浏览器给的 mimetype, 但业主直接在服务器上 (RDP/U盘)
 * 把文件拷进 media 目录时, 文件系统只有扩展名, 没有 mimetype。这份表按扩展名兜底猜
 * kind + mimeType, 只覆盖常见格式 (够用即可, 猜不出来的交给业主自己改文件名重传)。
 */
const EXT_KIND_MIME: Record<string, { kind: Exclude<MediaKind, 'webpage'>; mime: string }> = {
  '.mp4': { kind: 'video', mime: 'video/mp4' },
  '.mov': { kind: 'video', mime: 'video/quicktime' },
  '.mkv': { kind: 'video', mime: 'video/x-matroska' },
  '.avi': { kind: 'video', mime: 'video/x-msvideo' },
  '.webm': { kind: 'video', mime: 'video/webm' },
  '.flv': { kind: 'video', mime: 'video/x-flv' },
  '.wmv': { kind: 'video', mime: 'video/x-ms-wmv' },
  '.m4v': { kind: 'video', mime: 'video/x-m4v' },
  '.jpg': { kind: 'image', mime: 'image/jpeg' },
  '.jpeg': { kind: 'image', mime: 'image/jpeg' },
  '.png': { kind: 'image', mime: 'image/png' },
  '.gif': { kind: 'image', mime: 'image/gif' },
  '.webp': { kind: 'image', mime: 'image/webp' },
  '.bmp': { kind: 'image', mime: 'image/bmp' },
  '.mp3': { kind: 'audio', mime: 'audio/mpeg' },
  '.wav': { kind: 'audio', mime: 'audio/wav' },
  '.aac': { kind: 'audio', mime: 'audio/aac' },
  '.m4a': { kind: 'audio', mime: 'audio/mp4' },
  '.ogg': { kind: 'audio', mime: 'audio/ogg' },
  '.flac': { kind: 'audio', mime: 'audio/flac' },
  '.wma': { kind: 'audio', mime: 'audio/x-ms-wma' },
};

@Injectable()
export class MediaService implements OnModuleInit {
  /** 媒体存储根目录 (env MEDIA_ROOT, 默认 D:\Media — Windows / /var/lib/smart-control/media — *nix) */
  readonly mediaRoot: string;

  constructor(
    @InjectRepository(MediaAsset)
    private readonly repo: Repository<MediaAsset>,
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
  ) {
    const fromEnv = process.env.MEDIA_ROOT;
    if (fromEnv) {
      this.mediaRoot = resolve(fromEnv);
    } else if (process.platform === 'win32') {
      this.mediaRoot = 'D:\\Media';
    } else {
      this.mediaRoot = '/var/lib/smart-control/media';
    }
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    this.logger.info(`MediaService ready, root=${this.mediaRoot}`, { context: 'MediaService' });
  }

  /** Multer 临时上传根 (跟正式 root 同盘, 避免跨盘 rename 失败) */
  get tmpRoot(): string {
    return join(this.mediaRoot, '_tmp');
  }

  classifyKind(mimeType: string, filename?: string): MediaKind | null {
    if (VIDEO_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'video';
    if (IMAGE_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'image';
    if (AUDIO_MIME_PREFIXES.some((p) => mimeType.startsWith(p))) return 'audio';
    // 扩展名兜底: m4a/aac 等有时 mime 给成 application/octet-stream
    if (DOC_MIME.includes(mimeType)) return 'doc';
    if (filename) {
      const lower = filename.toLowerCase();
      if (AUDIO_EXT.some((ext) => lower.endsWith(ext))) return 'audio';
      if (DOC_EXT.some((ext) => lower.endsWith(ext))) return 'doc';
    }
    return null;
  }

  /** 放映守护回写文档元数据 (页数 / Word 转出的 PDF 相对路径) */
  async setDocMeta(id: number, meta: { pageCount?: number; pdfRelPath?: string }): Promise<MediaAsset> {
    const row = await this.repo.findOne({ where: { id } });
    if (!row) throw new NotFoundException(`media #${id} 不存在`);
    if (typeof meta.pageCount === 'number' && meta.pageCount > 0) row.pageCount = Math.floor(meta.pageCount);
    if (meta.pdfRelPath) row.docPdfPath = meta.pdfRelPath;
    return this.repo.save(row);
  }

  /** Multer 落到 tmp 后, 调用本方法把文件挪到正式位置 + 创建 DB 记录 */
  async ingest(file: Express.Multer.File, uploader: string, remark?: string): Promise<MediaAsset> {
    // multer 默认按 latin1 解码 originalname, 中文文件名会乱码 → 转回 utf8.
    // (纯 ASCII 文件名在 latin1/utf8 下字节一致, 转换是恒等, 不受影响)
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const kind = this.classifyKind(file.mimetype, originalName);
    if (!kind) {
      await this.unlinkSafe(file.path);
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype} (仅支持 video/* + image/* + audio/*)`);
    }

    // 先入库拿 id, 用 id 做目录避免文件名冲突
    const safeName = this.safeFilename(originalName);
    const entity = this.repo.create({
      originalName,
      safeName,
      path: '',
      thumbPath: null,
      kind,
      mimeType: file.mimetype,
      sizeBytes: file.size,
      durationSec: null,
      resolution: null,
      remark: remark ?? null,
      uploader,
      lastPlayedAt: null,
    });
    const saved = await this.repo.save(entity);

    const finalDir = join(this.mediaRoot, String(saved.id));
    const finalPath = join(finalDir, safeName);
    await fs.mkdir(finalDir, { recursive: true });
    await fs.rename(file.path, finalPath);
    saved.path = finalPath;

    return this.repo.save(saved);
  }

  /**
   * 扫描 mediaRoot 里数据库不认识的文件 —— 业主直接 RDP 进服务器把视频拷进 media
   * 文件夹, 不走上传接口, 库里没有记录, PWA 自然看不到 (这不是 bug, 是媒体库从来
   * 就只认数据库记录; 但业主确实有这个操作习惯, 得给条路认领)。
   * 只列出来, 不自动入库 —— 跟"从媒体库选"同一个原则: 磁盘上的东西要经人确认。
   */
  async scanOrphans(): Promise<OrphanMediaItem[]> {
    const known = new Set(
      (await this.repo.find({ select: ['path'] })).map((r) => resolve(r.path)),
    );
    const tmpRootResolved = resolve(this.tmpRoot);
    const results: OrphanMediaItem[] = [];

    const walk = async (dir: string): Promise<void> => {
      let entries: import('fs').Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return; // mediaRoot 还没建好之类, 当没有孤儿处理
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (resolve(full) === tmpRootResolved) continue; // _tmp 是上传中转站, 跳过
          await walk(full);
        } else if (entry.isFile()) {
          const resolved = resolve(full);
          if (known.has(resolved)) continue; // 已经在库里 (正常上传的文件), 不是孤儿
          const ext = extname(entry.name).toLowerCase();
          const guess = EXT_KIND_MIME[ext];
          const stat = await fs.stat(full);
          results.push({
            relPath: relative(this.mediaRoot, full),
            name: entry.name,
            sizeBytes: stat.size,
            kind: guess?.kind ?? null,
          });
        }
      }
    };

    await walk(this.mediaRoot);
    return results;
  }

  /** 把 scanOrphans() 列出的某一个文件正式收编成媒体库资源 (原地过户, 不重新写一份) */
  async importOrphan(relPath: string, uploader: string, remark?: string): Promise<MediaAsset> {
    const abs = resolve(join(this.mediaRoot, relPath));
    const rootResolved = resolve(this.mediaRoot);
    if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
      throw new BadRequestException('非法路径'); // 防 relPath 里塞 ../../ 之类的路径穿越
    }
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new NotFoundException('文件不存在, 可能已被移动或删除, 请重新扫描');
    }
    if (!stat.isFile()) throw new BadRequestException('不是文件');

    const ext = extname(abs).toLowerCase();
    const guess = EXT_KIND_MIME[ext];
    if (!guess) throw new BadRequestException(`不支持的文件类型: ${ext || '(无扩展名)'}`);

    const originalName = basename(abs);
    const safeName = this.safeFilename(originalName);
    const entity = this.repo.create({
      originalName,
      safeName,
      path: '',
      thumbPath: null,
      kind: guess.kind,
      mimeType: guess.mime,
      sizeBytes: stat.size,
      durationSec: null,
      resolution: null,
      remark: remark ?? null,
      uploader,
      lastPlayedAt: null,
    });
    const saved = await this.repo.save(entity);

    // 跟 ingest() 一样挪进 <mediaRoot>/<id>/ 标准布局, 这样 remove() 删目录才删得干净
    const finalDir = join(this.mediaRoot, String(saved.id));
    const finalPath = join(finalDir, safeName);
    await fs.mkdir(finalDir, { recursive: true });
    await fs.rename(abs, finalPath);
    saved.path = finalPath;
    return this.repo.save(saved);
  }

  /** 添加网页 URL 作为一条 kind='webpage' 的媒体记录 (无物理文件, 存 sourceUrl) */
  async createWebpage(name: string, url: string): Promise<MediaAsset> {
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      throw new BadRequestException('网页地址必须以 http:// 或 https:// 开头');
    }
    const entity = this.repo.create({
      originalName: (name || '').trim() || clean,
      safeName: 'webpage',
      path: '',
      thumbPath: null,
      kind: 'webpage',
      sourceUrl: clean,
      mimeType: 'text/html',
      sizeBytes: 0,
      durationSec: null,
      resolution: null,
      remark: null,
      uploader: 'system',
      lastPlayedAt: null,
    });
    return this.repo.save(entity);
  }

  async list(opts: { kind?: MediaKind; limit?: number; offset?: number } = {}): Promise<{ items: MediaListItem[]; total: number }> {
    const qb = this.repo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC');
    if (opts.kind) qb.andWhere('m.kind = :k', { k: opts.kind });
    const total = await qb.getCount();
    if (typeof opts.limit === 'number') qb.take(opts.limit);
    if (typeof opts.offset === 'number') qb.skip(opts.offset);
    const rows = await qb.getMany();
    return { items: rows.map((r) => this.toListItem(r)), total };
  }

  async get(id: number): Promise<MediaAsset> {
    const m = await this.repo.findOne({ where: { id } });
    if (!m) throw new NotFoundException(`媒体不存在: id=${id}`);
    return m;
  }

  async openStream(id: number, asPdf = false): Promise<{ stream: ReadStream; mimeType: string; size: number; filename: string }> {
    const m = await this.get(id);
    // 文档投屏: variant=pdf 时流出 Word 转出的 PDF (kiosk 逐页渲染用)
    if (asPdf) {
      if (!m.docPdfPath) throw new NotFoundException('该文档还没有转换出 PDF (放映守护转换中或未启动)');
      const pdfAbs = join(this.mediaRoot, m.docPdfPath);
      let psize = 0;
      try { psize = statSync(pdfAbs).size; } catch { throw new NotFoundException('PDF 文件不存在'); }
      return {
        stream: createReadStream(pdfAbs),
        mimeType: 'application/pdf',
        size: psize,
        filename: m.originalName.replace(/\.[^.]+$/, '') + '.pdf',
      };
    }
    let size = m.sizeBytes;
    try { size = statSync(m.path).size; } catch { /* keep DB size */ }
    return {
      stream: createReadStream(m.path),
      mimeType: m.mimeType,
      size,
      filename: m.originalName,
    };
  }

  /** 磁盘绝对路径 (放映守护打开原始文件用) */
  absPathOf(m: MediaAsset): string {
    return m.path;
  }

  async remove(id: number): Promise<{ removedId: number }> {
    const m = await this.get(id);
    const dir = join(this.mediaRoot, String(m.id));
    await this.rmDirSafe(dir);
    await this.repo.remove(m);
    return { removedId: id };
  }

  async markPlayed(id: number): Promise<void> {
    await this.repo.update(id, { lastPlayedAt: new Date() });
  }

  toListItem(m: MediaAsset): MediaListItem {
    return {
      id: m.id,
      originalName: m.originalName,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: Number(m.sizeBytes),
      durationSec: m.durationSec,
      resolution: m.resolution,
      remark: m.remark,
      uploader: m.uploader,
      thumbUrl: m.thumbPath ? `/api/media/${m.id}/thumb` : null,
      fileUrl: m.kind === 'webpage' ? (m.sourceUrl ?? '') : `/api/media/${m.id}/file`,
      lastPlayedAt: m.lastPlayedAt ? m.lastPlayedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
    };
  }

  private safeFilename(name: string): string {
    // 保留扩展名, 去掉路径符号 / 控制字符 / 引号
    return name
      .replace(/[ -\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, '_')
      .slice(0, 200) || 'unnamed';
  }

  private async unlinkSafe(p: string): Promise<void> {
    try { await fs.unlink(p); } catch { /* ignore */ }
  }

  private async rmDirSafe(p: string): Promise<void> {
    try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
