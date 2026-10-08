import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { WINSTON_MODULE_PROVIDER } from 'nest-winston';
import { Logger } from 'winston';
import { EntityManager, IsNull, Repository } from 'typeorm';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { boundedCommandFile } from '../../common/utils/bounded-command-file';
import { MediaQuotaService } from './media-quota.service';
import { promises as fs, ReadStream } from 'fs';
import { join, resolve, relative, basename, extname, sep, isAbsolute } from 'path';
import { spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { MediaAsset, MediaKind } from '../../entities/media-asset.entity';
import { PlaylistItem } from '../../entities/playlist-item.entity';
import { MediaListItem, OrphanMediaItem, UpdateMediaDto } from './dto/media.dto';
import { User } from '../../entities/user.entity';
import { byteRange } from './byte-range';
import { recoverableDelete } from './recoverable-delete';
import type { Actor } from '../../common/auth/actor';
import { assertCanUpload, assertReadResource, assertWriteResource } from '../../common/auth/resource-policy';
import {
  WELCOME_PHOTO_FOLDER,
  WELCOME_PHOTO_REMARK,
  isManagedMediaRelativePath,
  mediaAssetContainerForStoredPath,
  mediaAssetDirectory,
  mediaAssetParent,
} from './media-storage-layout';
import {
  classifyMediaKind,
  mediaFileTypeFromName,
  normalizeUploadedMimeType,
  safeMediaFilename,
} from './media-file-policy';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { resolveProductionMediaRoot } = require('../../../scripts/production-paths.cjs') as {
  resolveProductionMediaRoot: () => string;
};

@Injectable()
export class MediaService implements OnModuleInit {
  /** 媒体存储根目录 (env MEDIA_ROOT, 默认 D:\Media — Windows / /var/lib/smart-control/media — *nix) */
  readonly mediaRoot: string;
  private readonly preparing = new Set<number>();
  private readonly activeOperations = new Set<number>();
  private readonly imageResolutionCache = new Map<number, string>();
  acquireOperation(id: number): () => void {
    if (this.activeOperations.has(id)) throw new ConflictException('资料正在使用，请稍后重试');
    this.activeOperations.add(id);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeOperations.delete(id);
    };
  }

  constructor(
    @InjectRepository(MediaAsset)
    private readonly repo: Repository<MediaAsset>,
    private readonly config: ConfigService,
    @Inject(WINSTON_MODULE_PROVIDER)
    private readonly logger: Logger,
  ) {
    this.mediaRoot = resolveProductionMediaRoot();
  }

  async onModuleInit(): Promise<void> {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    await this.ensureAssetParent({ id: 0, kind: 'image', remark: WELCOME_PHOTO_REMARK });
    this.logger.info(`MediaService ready, root=${this.mediaRoot}`, { context: 'MediaService' });
  }

  /** Multer 临时上传根 (跟正式 root 同盘, 避免跨盘 rename 失败) */
  get tmpRoot(): string {
    return join(this.mediaRoot, '_tmp');
  }

  classifyKind(mimeType: string, filename?: string): MediaKind | null {
    return classifyMediaKind(mimeType, filename);
  }

  /** 放映守护回写文档元数据 (页数 / Word 转出的 PDF 相对路径) */
  async setDocMeta(id: number, meta: { pageCount?: number; pdfRelPath?: string }, authorization?: Actor | ((manager: EntityManager, row: MediaAsset) => Promise<void>), reservationId?: string): Promise<MediaAsset> {
    if (meta.pageCount !== undefined && (!Number.isInteger(meta.pageCount) || meta.pageCount < 1 || meta.pageCount > 100_000)) throw new BadRequestException('无效文档页数');
    if (meta.pdfRelPath !== undefined && (typeof meta.pdfRelPath !== 'string' || !meta.pdfRelPath || isAbsolute(meta.pdfRelPath))) throw new BadRequestException('无效PDF相对路径');
    return serializedTransaction(this.repo.manager.connection, async manager => {
      const row = await manager.findOneByOrFail(MediaAsset, { id });
      if (row.kind !== 'doc') throw new BadRequestException('资料不是文档');
      if (reservationId !== undefined && (!reservationId || !meta.pdfRelPath || row.processingStatus !== 'processing')) throw new BadRequestException('文档转换预留或状态无效');
      if (meta.pdfRelPath && row.processingStatus === 'processing' && !reservationId) throw new ForbiddenException('文档转换必须提交对应预留');
      const fields: Partial<MediaAsset> = {};
      if (meta.pageCount !== undefined) fields.pageCount = meta.pageCount;
      if (meta.pdfRelPath !== undefined) {
        const root = await fs.realpath(this.mediaRoot);
        const original = await fs.realpath(row.path);
        const rel = relative(root, original);
        if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel) || !['.doc', '.docx'].includes(extname(original).toLowerCase())) throw new BadRequestException('PDF必须属于当前Word文档');
        const expected = original.slice(0, -extname(original).length) + '.pdf';
        const requested = resolve(root, meta.pdfRelPath);
        if (requested !== expected || await fs.realpath(requested) !== expected) throw new BadRequestException('PDF路径与当前文档不匹配');
        const handle = await fs.open(requested, 'r');
        try {
          const header = Buffer.alloc(5);
          await handle.read(header, 0, 5, 0);
          if (header.toString() !== '%PDF-') throw new BadRequestException('转换结果不是PDF');
        } finally { await handle.close(); }
        const paths = new Set<string>();
        let bytes = 0;
        for (const value of [original, requested, row.sourcePath, row.thumbPath]) {
          if (!value) continue;
          const file = await fs.realpath(resolve(root, value));
          const local = relative(root, file);
          if (!local || local === '..' || local.startsWith('..' + sep) || isAbsolute(local)) throw new BadRequestException('文档文件超出媒体目录');
          if (paths.has(file)) continue;
          paths.add(file);
          const stat = await fs.stat(file);
          if (!stat.isFile()) throw new BadRequestException('文档路径不是文件');
          bytes += stat.size;
          if (!Number.isSafeInteger(bytes)) throw new BadRequestException('文档占用大小超出安全范围');
        }
        fields.docPdfPath = relative(root, requested).split(sep).join('/');
        fields.sizeBytes = bytes;
        if (reservationId) {
          const [reservation] = await manager.query('SELECT bytes FROM upload_reservations WHERE id = ? AND target_media_id = ? AND owner_user_id IS ? AND temp_name IS NULL', [reservationId, id, row.ownerUserId]);
          const budget = Number(reservation?.bytes);
          const outputBytes = (await fs.stat(requested)).size;
          const previousBytes = Number(row.sizeBytes);
          if (!reservation || !Number.isSafeInteger(budget) || budget < 1 || !Number.isSafeInteger(previousBytes) || previousBytes < 0 || outputBytes > budget || bytes - previousBytes > budget) throw new ForbiddenException('PDF超出转换预算或预留已失效');
          fields.processingStatus = 'ready';
          fields.processingError = null;
        }
      }
      // Recheck after filesystem awaits, using this transaction rather than nesting another one.
      if (typeof authorization === 'function') await authorization(manager, row);
      else if (authorization) {
        if (authorization.kind === 'user') {
          const current = await manager.findOneBy(User, { id: authorization.userId!, enabled: true, role: 'admin' });
          if (!current) throw new ForbiddenException('管理员权限已失效');
        } else if (authorization.kind !== 'admin' || authorization.role !== 'admin') throw new ForbiddenException('需要管理员权限');
      }
      if (Object.keys(fields).length) await manager.update(MediaAsset, id, fields);
      if (reservationId) await manager.query('DELETE FROM upload_reservations WHERE id = ? AND target_media_id = ? AND owner_user_id IS ? AND temp_name IS NULL', [reservationId, id, row.ownerUserId]);
      return manager.findOneByOrFail(MediaAsset, { id });
    });
  }

  /** Multer 落到 tmp 后, 调用本方法把文件挪到正式位置 + 创建 DB 记录 */
  async ingest(file: Express.Multer.File, uploader: string, remark?: string, actor?: Actor, reservationId?: string | null, source: 'upload' | 'import' | 'system' = 'upload'): Promise<MediaAsset> {
    if (actor) assertCanUpload(actor);
    if (source === 'system' && (actor?.kind !== 'admin' || actor.userId !== null)) throw new ForbiddenException('只有系统身份可创建内置素材');
    // multer 默认按 latin1 解码 originalname, 中文文件名会乱码 → 转回 utf8.
    // (纯 ASCII 文件名在 latin1/utf8 下字节一致, 转换是恒等, 不受影响)
    const originalName = Buffer.from(file.originalname, 'latin1').toString('utf8');
    const kind = this.classifyKind(file.mimetype, originalName);
    if (!kind) {
      await this.unlinkSafe(file.path);
      throw new BadRequestException(`不支持的文件类型: ${file.mimetype} (仅支持 video/* + image/* + audio/*)`);
    }
    // mime 纠正: 浏览器给 octet-stream/空时按扩展名换成标准值 —— 存进库的
    // mimeType 会成为 /media/:id/file 的 Content-Type, 冷门/错误值会让播放端拒识
    const mimeType = normalizeUploadedMimeType(file.mimetype, originalName);

    // 先入库拿 id, 用 id 做目录避免文件名冲突
    const safeName = safeMediaFilename(originalName);
    const entity = this.repo.create({
      originalName,
      safeName,
      path: '',
      thumbPath: null,
      kind,
      mimeType,
      sizeBytes: file.size,
      durationSec: null,
      resolution: null,
      remark: remark ?? null,
      uploader,
      ownerUserId: actor?.userId ?? null,
      visibility: source === 'system' ? 'shared' : 'private',
      source,
      processingStatus: kind === 'video' ? 'pending' : 'ready',
      processingError: null,
      sourcePath: null,
      lastPlayedAt: null,
    });
    const saved = reservationId ? await serializedTransaction(this.repo.manager.connection, async manager => {
      if (!actor || resolve(file.path) !== join(this.mediaRoot, '_tmp', basename(file.path))) throw new ForbiddenException('上传绑定无效');
      const created = await manager.save(MediaAsset, entity);
      const linked = await manager.createQueryBuilder().update('upload_reservations')
        .set({ target_media_id: created.id })
        .where('id = :id AND owner_user_id IS :owner AND temp_name = :name AND bytes = :bytes AND target_media_id IS NULL',
          { id: reservationId, owner: actor.userId, name: basename(file.path), bytes: file.size })
        .andWhere("(:owner IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = :owner AND enabled = 1 AND role IN ('admin', 'operator')))", { owner: actor.userId }).execute();
      if (!linked.affected) throw new ForbiddenException('上传绑定已失效');
      return created;
    }) : await this.saveInitialUpload(entity, actor);

    return this.finishNewAsset(saved, path => fs.rename(file.path, path));
  }

  /** 服务器侧来源 (在线曲库下载等) 从内存 buffer 入库 — 目录布局与 ingest 一致 */
  async ingestReservedBuffer(originalName: string, mimeType: string, buf: Buffer, actor: Actor, reservationId: string, remark?: string, source: 'import' | 'system' = 'import'): Promise<MediaAsset> {
    const quota = new MediaQuotaService(this.repo.manager.connection);
    const directory = join(this.mediaRoot, '_tmp');
    const name = randomUUID() + '.upload';
    const temporary = join(directory, name);
    let owned = false;
    try {
      await quota.shrinkUnbound(actor, reservationId, buf.length);
      await fs.mkdir(directory, { recursive: true });
      const stat = await fs.lstat(directory);
      const [root, actual] = await Promise.all([fs.realpath(this.mediaRoot), fs.realpath(directory)]);
      if (!stat.isDirectory() || stat.isSymbolicLink() || actual !== join(root, '_tmp')) throw new BadRequestException('导入临时目录不安全');
      await quota.bindTemporary(actor, reservationId, name);
      const handle = await fs.open(temporary, 'wx', 0o600);
      owned = true;
      try { await handle.writeFile(buf); } finally { await handle.close(); }
      return await this.ingest({ path: temporary, originalname: Buffer.from(originalName, 'utf8').toString('latin1'), mimetype: mimeType, size: buf.length } as Express.Multer.File,
        actor.username, remark, actor, reservationId, source);
    } finally {
      // Keep the reservation if owned temporary bytes could not be removed.
      if (owned) await fs.unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
      await quota.release(actor, reservationId);
    }
  }

  async ingestFromBuffer(originalName: string, mimeType: string, buf: Buffer, uploader: string, actor: Actor, remark?: string): Promise<MediaAsset> {
    assertCanUpload(actor);
    const kind = this.classifyKind(mimeType, originalName);
    if (!kind) throw new BadRequestException(`不支持的文件类型: ${mimeType}`);
    const safeName = safeMediaFilename(originalName);
    const saved = await this.saveInitialUpload(this.repo.create({
      originalName, safeName, path: '', thumbPath: null, kind, mimeType,
      sizeBytes: buf.length, durationSec: null, resolution: null,
      ownerUserId: actor.userId, visibility: 'private', source: 'import',
      remark: remark ?? null, uploader, lastPlayedAt: null,
      processingStatus: kind === 'video' ? 'pending' : 'ready', processingError: null, sourcePath: null,
    }), actor);
    return this.finishNewAsset(saved, path => fs.writeFile(path, buf));
  }

  /**
   * 服务器侧来源从**磁盘临时文件**入库 (百度网盘代下载等大文件用 — 流式落盘后
   * 挪进正式位置, 不像 ingestFromBuffer 把整个文件压进内存)。
   * rename 跨盘符会 EXDEV, 失败自动退化为 copy+unlink。
   */
  async ingestFromFile(originalName: string, mimeType: string, tmpPath: string, uploader: string, actor: Actor, remark?: string): Promise<MediaAsset> {
    assertCanUpload(actor);
    // Reject revoked identities before stat or unsupported-file cleanup. This is
    // deliberately additional to saveInitialUpload's in-transaction recheck.
    if (actor.userId !== null) {
      await serializedTransaction(this.repo.manager.connection, async manager => {
        const current = await manager.findOneBy(User, { id: actor.userId!, enabled: true });
        if (!current) throw new ForbiddenException('导入账户已停用');
        assertCanUpload({ ...actor, role: current.role });
      });
    }
    const kind = this.classifyKind(mimeType, originalName);
    if (!kind) {
      await this.unlinkSafe(tmpPath);
      throw new BadRequestException(`不支持的文件类型: ${mimeType} / ${originalName}`);
    }
    const stat = await fs.stat(tmpPath);
    const safeName = safeMediaFilename(originalName);
    const saved = await this.saveInitialUpload(this.repo.create({
      originalName, safeName, path: '', thumbPath: null, kind, mimeType,
      sizeBytes: stat.size, durationSec: null, resolution: null,
      ownerUserId: actor.userId, visibility: 'private', source: 'import',
      remark: remark ?? null, uploader, lastPlayedAt: null,
      processingStatus: kind === 'video' ? 'pending' : 'ready', processingError: null, sourcePath: null,
    }), actor);
    return this.finishNewAsset(saved, async path => {
      try { await fs.rename(tmpPath, path); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await fs.copyFile(tmpPath, path);
        await fs.unlink(tmpPath);
      }
    });
  }

  private async saveInitialUpload(entity: MediaAsset, actor?: Actor): Promise<MediaAsset> {
    return serializedTransaction(this.repo.manager.connection, async manager => {
      if (actor) {
        assertCanUpload(actor);
        if (actor.userId !== null) {
          const current = await manager.findOneBy(User, { id: actor.userId, enabled: true });
          if (!current) throw new ForbiddenException('导入账户已停用');
          assertCanUpload({ ...actor, role: current.role });
        }
      }
      return manager.save(MediaAsset, entity);
    });
  }

  private async finishNewAsset(saved: MediaAsset, write: (path: string) => Promise<void>): Promise<MediaAsset> {
    const release = this.acquireOperation(saved.id);
    let result: MediaAsset;
    try { result = await this.finishNewAssetLocked(saved, write); }
    finally { release(); }
    if (result.kind === 'video') void this.prepareVideo(result.id);
    if (result.kind === 'image') {
      try { result = await this.ensureImageResolution(result.id); }
      catch (error) {
        this.logger.warn?.(`[Media] 图片 #${result.id} 尺寸探测失败: ${(error as Error).message}`, { context: 'MediaService' });
      }
    }
    return result;
  }

  private async finishNewAssetLocked(saved: MediaAsset, write: (path: string) => Promise<void>): Promise<MediaAsset> {
    const directory = mediaAssetDirectory(this.mediaRoot, saved);
    const path = join(directory, saved.safeName);
    let created = false;
    let result: MediaAsset;
    try {
      const parent = await this.ensureAssetParent(saved);
      await fs.mkdir(parent, { recursive: true });
      // Never adopt or remove an existing ID directory during failed ingestion.
      await fs.mkdir(directory);
      created = true;
      await write(path);
      const fields: Partial<MediaAsset> = { path };
      if (saved.kind === 'doc' && extname(saved.originalName).toLowerCase() === '.pdf') fields.docPdfPath = relative(this.mediaRoot, path).split(sep).join('/');
      // Do not save the stale pre-upload entity over concurrent admin edits.
      result = await serializedTransaction(this.repo.manager.connection, async manager => {
        const updated = await manager.update(MediaAsset, saved.id, fields);
        if (!updated.affected) throw new NotFoundException('上传资料记录已不存在');
        return manager.findOneByOrFail(MediaAsset, { id: saved.id });
      });
    } catch (error) {
      // Remove only the newly created asset directory. If cleanup fails, retain
      // its DB row so residual bytes continue counting against the owner's quota.
      if (created) await fs.rm(directory, { recursive: true, force: true });
      await serializedTransaction(this.repo.manager.connection, manager => manager.delete(MediaAsset, saved.id));
      throw error;
    }
    return result;
  }

  /** 全部素材的原始文件名 (在线曲库标"已入库"用, 只拉一列) */
  async listOriginalNames(): Promise<string[]> {
    const rows = await this.repo.find({ select: { originalName: true } as never });
    return rows.map((r) => r.originalName);
  }

  /** 全部素材备注 (在线曲库靠备注里的溯源标识别中文名入库的曲子) */
  async listRemarks(): Promise<Array<string | null>> {
    const rows = await this.repo.find({ select: { remark: true } as never });
    return rows.map((r) => r.remark);
  }

  /**
   * 扫描 mediaRoot 里数据库不认识的文件 —— 业主直接 RDP 进服务器把视频拷进 media
   * 文件夹, 不走上传接口, 库里没有记录, PWA 自然看不到 (这不是 bug, 是媒体库从来
   * 就只认数据库记录; 但业主确实有这个操作习惯, 得给条路认领)。
   * 只列出来, 不自动入库 —— 跟"从媒体库选"同一个原则: 磁盘上的东西要经人确认。
   */
  async scanOrphans(): Promise<OrphanMediaItem[]> {
    const known = await this.registeredMediaPaths(this.repo);
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
        if (this.isManagedMediaPath(relative(this.mediaRoot, full))) continue;
        if (entry.isDirectory()) {
          if (entry.name.startsWith('.delete-')) continue;
          if (resolve(full) === tmpRootResolved) continue; // _tmp 是上传中转站, 跳过
          await walk(full);
        } else if (entry.isFile()) {
          const resolved = resolve(full);
          if (known.has(resolved) || known.has(await fs.realpath(full))) continue;
          const guess = mediaFileTypeFromName(entry.name);
          const stat = await fs.stat(full);
          // A hard-linked file can alias private managed content, including a
          // not-yet-finalized upload. Do not treat any shared inode as an orphan.
          if (stat.nlink !== 1) continue;
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

  private isManagedMediaPath(relPath: string): boolean {
    return isManagedMediaRelativePath(relPath);
  }

  private async ensureAssetParent(asset: Pick<MediaAsset, 'id' | 'kind' | 'remark'>): Promise<string> {
    await fs.mkdir(this.mediaRoot, { recursive: true });
    const parent = mediaAssetParent(this.mediaRoot, asset);
    if (resolve(parent) === resolve(this.mediaRoot)) return this.mediaRoot;
    await fs.mkdir(parent, { recursive: true });
    const stat = await fs.lstat(parent);
    const [realRoot, realParent] = await Promise.all([fs.realpath(this.mediaRoot), fs.realpath(parent)]);
    if (!stat.isDirectory() || stat.isSymbolicLink() || realParent !== join(realRoot, WELCOME_PHOTO_FOLDER)) {
      throw new Error('Unsafe welcome photo storage directory');
    }
    return parent;
  }

  private async registeredMediaPaths(repo: Repository<MediaAsset>): Promise<Set<string>> {
    const rows = await repo.find({ select: ['path', 'sourcePath', 'thumbPath', 'docPdfPath'] });
    const known = new Set<string>();
    for (const row of rows) {
      const candidates = [row.path, row.sourcePath,
        row.thumbPath ? resolve(this.mediaRoot, row.thumbPath) : null,
        row.docPdfPath ? resolve(this.mediaRoot, row.docPdfPath) : null];
      for (const candidate of candidates) {
        if (!candidate) continue;
        known.add(resolve(candidate));
        try { known.add(await fs.realpath(candidate)); }
        catch (error) {
          // Missing registered files still reserve their declared paths. Other
          // filesystem failures must not relabel protected data as an orphan.
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      }
    }
    return known;
  }

  /** 把 scanOrphans() 列出的某一个文件正式收编成媒体库资源 (原地过户, 不重新写一份) */
  async importOrphan(relPath: string, uploader: string, actor: Actor, remark?: string): Promise<MediaAsset> {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可收编服务器资料');
    await this.assertCurrentImportAdministrator(actor);
    const abs = resolve(join(this.mediaRoot, relPath));
    const rootResolved = resolve(this.mediaRoot);
    if (abs !== rootResolved && !abs.startsWith(rootResolved + sep)) {
      throw new BadRequestException('非法路径'); // 防 relPath 里塞 ../../ 之类的路径穿越
    }
    const realRoot = await fs.realpath(this.mediaRoot);
    const realFile = await fs.realpath(abs);
    const realRelative = relative(realRoot, realFile);
    if (!realRelative || realRelative.startsWith('..') || isAbsolute(realRelative)) throw new BadRequestException('非法路径');
    if (this.isManagedMediaPath(relative(rootResolved, abs)) || this.isManagedMediaPath(realRelative)) {
      throw new BadRequestException('受管资料、上传临时文件或删除隔离文件不能收编，请使用恢复流程');
    }
    let stat;
    try {
      stat = await fs.stat(abs);
    } catch {
      throw new NotFoundException('文件不存在, 可能已被移动或删除, 请重新扫描');
    }
    if (!stat.isFile()) throw new BadRequestException('不是文件');
    if (stat.nlink !== 1) throw new BadRequestException('硬链接文件不能收编，请先复制为独立文件');
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new BadRequestException('文件大小无效');

    const ext = extname(abs).toLowerCase();
    const guess = mediaFileTypeFromName(abs);
    if (!guess) throw new BadRequestException(`不支持的文件类型: ${ext || '(无扩展名)'}`);

    const originalName = basename(abs);
    const safeName = safeMediaFilename(originalName);
    const entity = this.repo.create({
      ownerUserId: actor.userId, visibility: 'private', source: 'import',
      originalName,
      safeName,
      path: '',
      thumbPath: null,
      kind: guess.kind,
      mimeType: guess.mimeType,
      sizeBytes: stat.size,
      durationSec: null,
      resolution: null,
      remark: remark ?? null,
      uploader,
      processingStatus: guess.kind === 'video' ? 'pending' : 'ready',
      processingError: null,
      sourcePath: null,
      lastPlayedAt: null,
    });
    const saved = await serializedTransaction(this.repo.manager.connection, async manager => {
      const known = await this.registeredMediaPaths(manager.getRepository(MediaAsset));
      if (known.has(abs) || known.has(realFile)) throw new ConflictException('文件已关联资料，不能重复收编');
      const reservationId = actor.userId === null ? null : randomUUID();
      if (actor.userId !== null) {
        const current = await manager.findOneBy(User, { id: actor.userId, enabled: true, role: 'admin' });
        if (!current) throw new ForbiddenException('收编账户已停用或不再是管理员');
        // Atomically claim capacity before allocation; convert the reservation
        // into the asset's accounted bytes within this same transaction.
        await manager.query(`INSERT INTO upload_reservations (id, owner_user_id, bytes)
          SELECT ?, u.id, ? FROM users u WHERE u.id = ? AND u.enabled = 1 AND u.role = 'admin'
          AND ? <= u.storage_quota_bytes
            - COALESCE((SELECT SUM(m.sizeBytes) FROM media_assets m WHERE m.owner_user_id = u.id), 0)
            - COALESCE((SELECT SUM(r.bytes) FROM upload_reservations r WHERE r.owner_user_id = u.id), 0)`,
          [reservationId, stat.size, actor.userId, stat.size]);
        if (!(await manager.query('SELECT id FROM upload_reservations WHERE id = ?', [reservationId])).length) {
          throw new ForbiddenException('收编账户存储配额不足或权限已变化');
        }
      }
      const created = await manager.save(MediaAsset, entity);
      if (reservationId) await manager.query('DELETE FROM upload_reservations WHERE id = ?', [reservationId]);
      return created;
    });

    const release = this.acquireOperation(saved.id);
    let result: MediaAsset;
    let allocatedDirectory = false;
    let moved = false;
    let finalDir = '';
    let finalPath = '';
    try {
      // Never adopt an occupied ID directory, overwrite its files or restore
      // stale ownership from the initial entity during finalization.
      const finalParent = await this.ensureAssetParent(saved);
      finalDir = mediaAssetDirectory(this.mediaRoot, saved);
      finalPath = join(finalDir, safeName);
      await fs.mkdir(finalParent, { recursive: true });
      await fs.mkdir(finalDir);
      allocatedDirectory = true;
      await fs.rename(abs, finalPath);
      moved = true;
      const finalStat = await fs.stat(finalPath);
      if (!finalStat.isFile() || finalStat.size !== stat.size || finalStat.nlink !== 1) {
        throw new ConflictException('收编期间文件大小发生变化或新增硬链接，请确认文件复制完成后重试');
      }
      const fields: Partial<MediaAsset> = { path: finalPath };
      if (guess.kind === 'doc' && ext === '.pdf') {
        fields.docPdfPath = relative(this.mediaRoot, finalPath).split(sep).join('/');
      }
      result = await serializedTransaction(this.repo.manager.connection, async manager => {
        const updated = await manager.update(MediaAsset, saved.id, fields);
        if (!updated.affected) throw new NotFoundException('资料不存在');
        return manager.findOneByOrFail(MediaAsset, { id: saved.id });
      });
    } catch (error) {
      try {
        if (allocatedDirectory) {
          if (moved) {
            // Exclusive hard-link restoration: rename could silently overwrite
            // a new file placed at the original path while we were committing.
            // If unsupported or occupied, preserve both row and staged file.
            await fs.link(finalPath, abs);
            await fs.unlink(finalPath);
          }
          // Never recursively erase unexpected files added to the directory.
          await fs.rmdir(finalDir);
        }
        await serializedTransaction(this.repo.manager.connection, manager => manager.delete(MediaAsset, saved.id));
      } catch {
        throw new ConflictException('收编失败且自动恢复未完成，已保留资料记录及现存文件，请管理员检查恢复');
      }
      throw error;
    } finally {
      release();
    }
    if (guess.kind === 'video') void this.prepareVideo(result.id);
    return result;
  }

  private async assertCurrentImportAdministrator(actor: Actor): Promise<void> {
    if (actor.userId === null) return;
    await serializedTransaction(this.repo.manager.connection, async manager => {
      const current = await manager.findOneBy(User, { id: actor.userId!, enabled: true, role: 'admin' });
      if (!current) throw new ForbiddenException('收编账户已停用或不再是管理员');
    });
  }

  /** 添加网页 URL 作为一条 kind='webpage' 的媒体记录 (无物理文件, 存 sourceUrl) */
  async createWebpage(name: string, url: string, actor?: Actor): Promise<MediaAsset> {
    if (actor) assertCanUpload(actor);
    const clean = url.trim();
    if (!/^https?:\/\//i.test(clean)) {
      throw new BadRequestException('网页地址必须以 http:// 或 https:// 开头');
    }
    const entity = this.repo.create({
      originalName: (name || '').trim() || clean,
      ownerUserId: actor?.userId ?? null,
      visibility: 'private',
      source: 'webpage',
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
      uploader: actor?.username ?? 'system',
      lastPlayedAt: null,
    });
    return this.saveInitialUpload(entity, actor);
  }

  async list(opts: { kind?: MediaKind; limit?: number; offset?: number; actor?: Actor; scope?: 'visible' | 'mine' | 'shared'; ownerUserId?: number; keyword?: string } = {}): Promise<{ items: MediaListItem[]; total: number }> {
    const result = await serializedTransaction(this.repo.manager.connection, async manager => {
      let actor = opts.actor;
      if (actor && actor.userId !== null) {
        const current = await manager.findOneBy(User, { id: actor.userId, enabled: true });
        if (!current) throw new ForbiddenException('账户已停用');
        actor = { ...actor, role: current.role };
      }
      return this.listInTransaction(manager.getRepository(MediaAsset), { ...opts, actor });
    });
    // Old image rows predate dimension metadata. Inspect them outside the
    // transaction so the media list and LED editor agree on geometry without
    // turning a GET into a database write. The next explicit save persists it.
    for (const item of result.items) {
      if (item.kind !== 'image' || item.resolution) continue;
      try {
        const resolved = await this.ensureImageResolution(item.id, false);
        item.resolution = resolved.resolution;
      } catch (error) {
        this.logger.warn?.(`[Media] 图片 #${item.id} 尺寸补录失败: ${(error as Error).message}`, { context: 'MediaService' });
      }
    }
    return result;
  }

  /** Inspect missing image geometry; explicit writes may persist the repaired metadata. */
  async ensureImageResolution(id: number, persist = true): Promise<MediaAsset> {
    const media = await this.get(id);
    if (media.kind !== 'image') throw new BadRequestException('资料不是图片');
    if (/^\d+x\d+$/i.test(media.resolution ?? '')) return media;
    const cached = this.imageResolutionCache.get(id);
    if (cached) {
      if (persist) await this.updateMediaFields(id, { resolution: cached });
      return { ...media, resolution: cached };
    }

    const root = await fs.realpath(this.mediaRoot);
    const file = await fs.realpath(media.path);
    const rel = relative(root, file);
    if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new BadRequestException('图片文件超出媒体目录');
    }
    const stat = await fs.stat(file);
    if (!stat.isFile()) throw new BadRequestException('图片文件不存在');
    const probe = await this.probeVideo(file);
    if (!Number.isInteger(probe.width) || !Number.isInteger(probe.height)
      || probe.width! < 1 || probe.height! < 1) {
      throw new BadRequestException('无法读取图片尺寸');
    }
    const resolution = `${probe.width}x${probe.height}`;
    this.imageResolutionCache.set(id, resolution);
    if (persist) await this.updateMediaFields(id, { resolution });
    return { ...media, resolution };
  }

  private async listInTransaction(repo: Repository<MediaAsset>, opts: NonNullable<Parameters<MediaService['list']>[0]>): Promise<{ items: MediaListItem[]; total: number }> {
    if (opts.keyword !== undefined && (typeof opts.keyword !== 'string' || opts.keyword.length > 200)) throw new BadRequestException('搜索文本过长');
    if (opts.scope && !['visible', 'mine', 'shared'].includes(opts.scope)) throw new BadRequestException('无效资料范围');
    if (opts.ownerUserId !== undefined) {
      if (opts.actor?.role !== 'admin') throw new ForbiddenException('仅管理员可按用户筛选');
      if (!Number.isInteger(opts.ownerUserId) || opts.ownerUserId < 1) throw new BadRequestException('无效用户');
    }
    for (const [value, min] of [[opts.limit, 1], [opts.offset, 0]] as const) {
      if (value !== undefined && (!Number.isSafeInteger(value) || value < min)) throw new BadRequestException('无效分页参数');
    }
    const qb = repo.createQueryBuilder('m').orderBy('m.createdAt', 'DESC').addOrderBy('m.id', 'DESC');
    if (opts.keyword?.trim()) qb.andWhere('instr(lower(m.originalName), lower(:keyword)) > 0', { keyword: opts.keyword.trim() });
    if (opts.actor && opts.actor.role !== 'admin') {
      qb.andWhere('(m.visibility = :shared OR m.ownerUserId = :owner)', {
        shared: 'shared', owner: opts.actor.kind === 'user' ? opts.actor.userId : null,
      });
    }
    if (opts.kind) qb.andWhere('m.kind = :k', { k: opts.kind });
    if (opts.scope === 'shared') qb.andWhere('m.visibility = :visibility', { visibility: 'shared' });
    if (opts.scope === 'mine') {
      if (!opts.actor || opts.actor.userId === null) qb.andWhere('1 = 0');
      else qb.andWhere('m.ownerUserId = :mine', { mine: opts.actor.userId });
    }
    if (opts.ownerUserId !== undefined) qb.andWhere('m.ownerUserId = :selectedOwner', { selectedOwner: opts.ownerUserId });
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

  async authorized(id: number, actor: Actor, write = false): Promise<MediaAsset> {
    return serializedTransaction(this.repo.manager.connection, async manager => {
      let current = actor;
      if (actor.userId !== null) {
        const user = await manager.findOneBy(User, { id: actor.userId, enabled: true });
        if (!user) throw new ForbiddenException('账户已停用');
        current = { ...actor, role: user.role };
      }
      const media = await manager.findOneBy(MediaAsset, { id });
      if (!media) throw new NotFoundException('资料不存在');
      if (write) {
        if (media.source === 'system') throw new ForbiddenException('内置资料由版本发布统一管理');
        assertWriteResource(current, media);
      }
      else assertReadResource(current, media);
      return media;
    });
  }

  async updateOwned(id: number, actor: Actor, dto: UpdateMediaDto): Promise<MediaAsset> {
    assertCanUpload(actor);
    return serializedTransaction(this.repo.manager.connection, async manager => {
      let currentActor = actor;
      if (actor.userId !== null) {
        const current = await manager.findOneBy(User, { id: actor.userId, enabled: true });
        if (!current) throw new ForbiddenException('账户已停用');
        currentActor = { ...actor, role: current.role };
      }
      return this.updateOwnedInTransaction(manager.getRepository(MediaAsset), id, currentActor, dto);
    });
  }

  private async updateOwnedInTransaction(repo: Repository<MediaAsset>, id: number, actor: Actor, dto: UpdateMediaDto): Promise<MediaAsset> {
    const row = await repo.findOneBy({ id });
    if (!row) throw new NotFoundException('资料不存在');
    if (row.source === 'system') throw new ForbiddenException('内置资料由版本发布统一管理');
    assertWriteResource(actor, row);
    const previousOwner = row.ownerUserId;
    if (dto.ownerUserId !== undefined && dto.ownerUserId !== previousOwner && ['pending', 'processing'].includes(row.processingStatus)) {
      throw new ConflictException('资料转码期间不能转移归属');
    }
    if ((dto.visibility !== undefined || dto.ownerUserId !== undefined) && actor.role !== 'admin') {
      throw new ForbiddenException('仅管理员可调整资料归属或公共状态');
    }
    if (dto.ownerUserId !== undefined) {
      if (!Number.isInteger(dto.ownerUserId) || dto.ownerUserId! < 1) throw new BadRequestException('归属用户无效');
      const owner = await repo.manager.getRepository(User).findOneBy({ id: dto.ownerUserId, enabled: true });
      if (!owner) throw new BadRequestException('目标用户不存在或已停用');
      row.ownerUserId = owner.id;
    }
    if (dto.visibility !== undefined) {
      if (dto.visibility !== 'private' && dto.visibility !== 'shared') throw new BadRequestException('可见范围无效');
      row.visibility = dto.visibility;
    }
    if (dto.originalName !== undefined) {
      if (typeof dto.originalName !== 'string' || !dto.originalName.trim()) throw new BadRequestException('资料名称不能为空');
      row.originalName = dto.originalName.trim();
    }
    if (dto.remark !== undefined) {
      if (typeof dto.remark !== 'string') throw new BadRequestException('备注无效');
      row.remark = dto.remark.trim();
    }
    const changes: Partial<MediaAsset> = {};
    if (dto.ownerUserId !== undefined) changes.ownerUserId = row.ownerUserId;
    if (dto.visibility !== undefined) changes.visibility = row.visibility;
    if (dto.originalName !== undefined) changes.originalName = row.originalName;
    if (dto.remark !== undefined) changes.remark = row.remark;
    if (!Object.keys(changes).length) return row;
    const update = repo.createQueryBuilder().update(MediaAsset).set(changes).where('id = :id', { id });
    if (previousOwner === null) update.andWhere('owner_user_id IS NULL');
    else update.andWhere('owner_user_id = :previousOwner', { previousOwner });
    if (actor.role !== 'admin') update.andWhere("visibility = 'private'");
    if (dto.ownerUserId !== undefined && dto.ownerUserId !== previousOwner) {
      // Failed conversion/cleanup can retain a reservation after processing stops.
      // Keep its owner and the resource owner aligned until explicit recovery.
      update.andWhere('NOT EXISTS (SELECT 1 FROM upload_reservations active WHERE active.target_media_id = :id)', { id });
      update.andWhere(`EXISTS (SELECT 1 FROM users u WHERE u.id = :target AND u.enabled = 1
        AND media_assets.sizeBytes <= u.storage_quota_bytes
          - COALESCE((SELECT SUM(m.sizeBytes) FROM media_assets m WHERE m.owner_user_id = u.id AND m.id <> :id), 0)
          - COALESCE((SELECT SUM(r.bytes) FROM upload_reservations r WHERE r.owner_user_id = u.id), 0))`, { target: dto.ownerUserId, id });
    }
    const result = await update.execute();
    if (!result.affected) throw new ForbiddenException('资料归属已变化、仍有待恢复预留或目标用户配额不足');
    return repo.findOneByOrFail({ id });
  }

  /**
   * 把素材可见范围置为 shared（系统内部调用）。用于"设为欢迎页底图/Logo/照片/主媒体"
   * 等需被公共页面与其他角色（操作员）看到的场景：素材一旦被系统页引用就应共享，否则
   * 非上传者在媒体列表里看不到、会误以为文件丢失。素材不存在或为内置资料则忽略。
   */
  async markShared(mediaId: number): Promise<void> {
    if (!Number.isInteger(mediaId) || mediaId < 1) return;
    const row = await this.repo.findOneBy({ id: mediaId });
    if (!row || row.source === 'system') return;
    if (row.visibility !== 'shared') {
      await this.repo.update({ id: mediaId }, { visibility: 'shared' });
    }
  }

  /** 按内置原始名称精确查；用户同名资料绝不能替代系统投放目标。 */
  findByOriginalName(originalName: string): Promise<MediaAsset | null> {
    return this.repo.findOne({ where: { originalName, ownerUserId: IsNull(), source: 'system' } });
  }

  async openStream(id: number, asPdf = false, rangeHeader?: string): Promise<{
    stream: ReadStream | null; mimeType: string; size: number; filename: string;
    status: number; contentRange?: string;
  }> {
    const m = await this.get(id);
    let file = m.path;
    let filename = m.originalName;
    let mimeType = m.mimeType;
    if (asPdf) {
      if (!m.docPdfPath) throw new NotFoundException('该文档还没有转换出 PDF (放映守护转换中或未启动)');
      file = resolve(this.mediaRoot, m.docPdfPath);
      const rel = relative(this.mediaRoot, file);
      if (rel === '..' || rel.startsWith(`..${sep}`) || resolve(file) === resolve(this.mediaRoot)) {
        throw new NotFoundException('文件不存在');
      }
      filename = m.originalName.replace(/\.[^.]+$/, '') + '.pdf';
      mimeType = 'application/pdf';
    }
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
    try {
      const root = await fs.realpath(this.mediaRoot);
      file = await fs.realpath(file);
      const rel = relative(root, file);
      if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error('outside media root');
      const expected = await fs.stat(file, { bigint: true });
      if (!expected.isFile() || expected.ino === 0n) throw new Error('unverifiable file');
      handle = await fs.open(file, 'r');
      const opened = await handle.stat({ bigint: true });
      if (!opened.isFile() || opened.dev !== expected.dev || opened.ino !== expected.ino) throw new Error('file replaced');
      const size = Number(opened.size);
      if (!Number.isSafeInteger(size) || size < 0) throw new Error('invalid file size');
      const range = byteRange(rangeHeader, size);
      if (!range) return { stream: null, mimeType, filename, size: 0, status: 416, contentRange: `bytes */${size}` };
      if (size === 0) return { stream: null, mimeType, filename, size: 0, status: 200 };
      // Read through the verified descriptor, not a second asynchronous path open.
      const stream = handle.createReadStream({ start: range.start, end: range.end });
      handle = undefined; // Stream now owns and automatically closes the handle.
      return {
        stream, mimeType, filename, size: range.partial ? range.end - range.start + 1 : size,
        status: range.partial ? 206 : 200,
        contentRange: range.partial ? `bytes ${range.start}-${range.end}/${size}` : undefined,
      };
    } catch { throw new NotFoundException('文件不存在'); }
    finally { await handle?.close(); }
  }

  /** 磁盘绝对路径 (放映守护打开原始文件用) */
  absPathOf(m: MediaAsset): string {
    return m.path;
  }

  async remove(id: number, actor: Actor): Promise<{ removedId: number; cleanupPending: boolean }> {
    const release = this.acquireOperation(id);
    try {
      const m = await this.authorized(id, actor, true);
      if (m.source === 'system') throw new ForbiddenException('内置资料由版本发布统一管理');
      if (this.preparing.has(id) || m.processingStatus === 'processing' || m.processingStatus === 'pending') throw new ConflictException('资料正在转码，不能删除');
      const channels = await this.repo.query('SELECT id FROM playback_channels WHERE currentMediaId = ? LIMIT 1', [id]);
      if (channels.length) throw new ConflictException('资料正在播放或暂停，请先停止播放再删除');
      const assetContainer = mediaAssetContainerForStoredPath(this.mediaRoot, m.id, m.path);
      const result = await recoverableDelete(assetContainer, m.id, () => serializedTransaction(this.repo.manager.connection, async manager => {
        const current = await manager.getRepository(MediaAsset).findOneBy({ id });
        if (!current) throw new NotFoundException('资料不存在');
        if (current.source === 'system') throw new ForbiddenException('内置资料由版本发布统一管理');
        assertWriteResource(actor, current);
        if (current.processingStatus === 'processing' || current.processingStatus === 'pending') throw new ConflictException('资料正在转码');
        if ((await manager.query('SELECT id FROM playback_channels WHERE currentMediaId = ? LIMIT 1', [id])).length) throw new ConflictException('请先停止播放再删除');
        // Remove every now-unplayable reference atomically; historical snapshots remain
        // owned by their original actor and cannot be replayed without a live asset.
        await manager.delete(PlaylistItem, { mediaId: id });
        await manager.delete(MediaAsset, { id });
      }));
      if (result.cleanupPending) this.logger.warn(`[Media] 已删除记录 #${id} 的隔离文件待清理`, { context: 'MediaService' });
      return { removedId: id, cleanupPending: result.cleanupPending };
    } finally { release(); }
  }

  async markPlayed(id: number): Promise<void> {
    await this.updateMediaFields(id, { lastPlayedAt: new Date() });
  }

  private async updateMediaFields(id: number, fields: Partial<MediaAsset>): Promise<void> {
    await serializedTransaction(this.repo.manager.connection, async manager => {
      const result = await manager.update(MediaAsset, id, fields);
      if (!result.affected) throw new NotFoundException('资料不存在');
    });
  }

  async mediaToolStatus(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
    const [ffmpeg, ffprobe] = await Promise.all([
      this.commandWorks(this.ffmpegCommand(), ['-version']),
      this.commandWorks(this.ffprobeCommand(), ['-version']),
    ]);
    return { ffmpeg, ffprobe };
  }

  /** 探测真实编码；浏览器不稳播的格式生成 H.264/AAC MP4 播放副本。 */
  async prepareVideo(id: number): Promise<void> {
    if (this.preparing.has(id)) return;
    const release = this.acquireOperation(id);
    this.preparing.add(id);
    let conversionTemp: string | undefined;
    let conversionReservation: { id: string | null; bytes: number } | undefined;
    let outputInstalled = false;
    let outputAccounted = false;
    const quota = new MediaQuotaService(this.repo.manager.connection);
    try {
      const media = await serializedTransaction(this.repo.manager.connection, async manager => {
        const current = await manager.findOneBy(MediaAsset, { id });
        if (!current) throw new NotFoundException('资料不存在');
        if (current.kind !== 'video') throw new BadRequestException('只有视频需要转码');
        await manager.update(MediaAsset, id, { processingStatus: 'processing', processingError: null });
        return current;
      });

      const source = media.sourcePath || media.path;
      const probe = await this.probeVideo(source);
      media.durationSec = probe.duration ? Math.round(probe.duration) : media.durationSec;
      media.resolution = probe.width && probe.height ? `${probe.width}x${probe.height}` : media.resolution;
      const ext = extname(source).toLowerCase();
      const browserReady = ext === '.mp4' && probe.videoCodec === 'h264'
        && (!probe.audioCodec || probe.audioCodec === 'aac' || probe.audioCodec === 'mp3');
      if (browserReady) {
        media.mimeType = 'video/mp4';
        media.processingStatus = 'ready';
        await this.updateMediaFields(id, { mimeType: media.mimeType, processingStatus: 'ready', durationSec: media.durationSec, resolution: media.resolution });
        return;
      }

      const dir = join(this.mediaRoot, String(media.id));
      conversionReservation = await quota.reserveConversion(id, media.ownerUserId, Number(process.env.MEDIA_TRANSCODE_MAX_BYTES ?? 10 * 1024 ** 3), this.mediaRoot);
      const temp = join(dir, `playback-converting-${randomUUID()}.mp4`);
      conversionTemp = temp;
      // An uploaded original may itself be named playback.mp4. Never replace it.
      const output = join(dir, resolve(source) === resolve(dir, 'playback.mp4') ? 'playback-derived.mp4' : 'playback.mp4');
      await this.runTranscode(this.ffmpegCommand(), [
        '-i', source, '-map', '0:v:0', '-map', '0:a?',
        '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
        '-c:a', 'aac', '-b:a', '192k', '-movflags', '+frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1',
      ], temp, conversionReservation.bytes);
      await fs.rename(temp, output);
      outputInstalled = true;
      media.sourcePath = source;
      media.path = output;
      media.mimeType = 'video/mp4';
      const retainedPaths = new Set([source, output, media.thumbPath, media.docPdfPath]
        .filter((value): value is string => !!value)
        .map(value => resolve(this.mediaRoot, value)));
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
      await this.updateMediaFields(id, {
        sourcePath: media.sourcePath, path: media.path, mimeType: media.mimeType,
        sizeBytes: media.sizeBytes, processingStatus: 'ready', processingError: null,
        durationSec: media.durationSec, resolution: media.resolution,
      });
      outputAccounted = true;
      this.logger.info(`[Media] 视频 #${id} 已转为 H.264/AAC 播放副本`, { context: 'MediaService' });
    } catch (error) {
      // Exclusive creation failed: this path was not created by this attempt.
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') conversionTemp = undefined;
      const message = (error as Error).message.slice(0, 1000);
      await this.updateMediaFields(id, { processingStatus: 'failed', processingError: message }).catch(() => {});
      this.logger.error(`[Media] 视频 #${id} 兼容处理失败: ${message}`, { context: 'MediaService' });
    } finally {
      let cleanupComplete = true;
      if (conversionTemp) {
        await fs.unlink(conversionTemp).catch(error => {
          if (error.code !== 'ENOENT') {
            cleanupComplete = false;
            this.logger.error(`[Media] 视频 #${id} 临时转码文件清理失败，保留待恢复`, { context: 'MediaService' });
          }
        });
      }
      if (conversionReservation && cleanupComplete && (!outputInstalled || outputAccounted)) {
        await quota.releaseConversion(conversionReservation.id, id).catch(() => {
          this.logger.error(`[Media] 视频 #${id} 转码预留释放失败，保留待恢复`, { context: 'MediaService' });
        });
      }
      this.preparing.delete(id);
      release();
    }
  }

  private async probeVideo(file: string): Promise<{ videoCodec?: string; audioCodec?: string; width?: number; height?: number; duration?: number }> {
    const output = await this.runCommand(this.ffprobeCommand(), [
      '-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', file,
    ], true);
    const parsed = JSON.parse(output) as { streams?: Array<{ codec_type: string; codec_name?: string; width?: number; height?: number }>; format?: { duration?: string } };
    const video = parsed.streams?.find((stream) => stream.codec_type === 'video');
    const audio = parsed.streams?.find((stream) => stream.codec_type === 'audio');
    if (!video) throw new Error('文件中没有视频轨');
    return { videoCodec: video.codec_name, audioCodec: audio?.codec_name, width: video.width, height: video.height, duration: Number(parsed.format?.duration) || undefined };
  }

  private commandWorks(command: string, args: string[]): Promise<boolean> {
    return this.runCommand(command, args, true).then(() => true, () => false);
  }

  private runTranscode(command: string, args: string[], output: string, maxBytes: number): Promise<void> {
    return boundedCommandFile(command, args, output, maxBytes);
  }

  private runCommand(command: string, args: string[], capture = false): Promise<string> {
    return new Promise((resolvePromise, reject) => {
      const child = spawn(command, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk) => { if (capture && stdout.length < 2_000_000) stdout += chunk.toString(); });
      child.stderr.on('data', (chunk) => { if (stderr.length < 8000) stderr += chunk.toString(); });
      child.once('error', reject);
      child.once('close', (code) => code === 0 ? resolvePromise(stdout) : reject(new Error(`${command} 退出码 ${code}: ${stderr.slice(-2000)}`)));
    });
  }

  private ffmpegCommand(): string {
    return process.env.FFMPEG_PATH
      || (process.platform === 'win32' ? 'D:\\smart-control-tools\\ffmpeg\\bin\\ffmpeg.exe' : 'ffmpeg');
  }

  private ffprobeCommand(): string {
    return process.env.FFPROBE_PATH
      || (process.platform === 'win32' ? 'D:\\smart-control-tools\\ffmpeg\\bin\\ffprobe.exe' : 'ffprobe');
  }

  toListItem(m: MediaAsset): MediaListItem {
    return {
      ownerUserId: m.ownerUserId,
      visibility: m.visibility,
      source: m.source,
      id: m.id,
      originalName: m.originalName,
      kind: m.kind,
      mimeType: m.mimeType,
      sizeBytes: Number(m.sizeBytes),
      durationSec: m.durationSec,
      resolution: m.resolution,
      remark: m.remark,
      uploader: m.uploader,
      // 图片一律走缩略图端点: 已生成则直接返回, 未生成(历史图)由端点 lazy 补,
      // 前端列表据此零原图下载。其它类型仅在确有 thumbPath 时返回。
      thumbUrl:
        m.kind === 'image'
          ? `/api/media/${m.id}/thumb`
          : m.thumbPath
            ? `/api/media/${m.id}/thumb`
            : null,
      fileUrl: m.kind === 'webpage' ? (m.sourceUrl ?? '') : `/api/media/${m.id}/file`,
      lastPlayedAt: m.lastPlayedAt ? m.lastPlayedAt.toISOString() : null,
      createdAt: m.createdAt.toISOString(),
      processingStatus: m.processingStatus ?? 'ready',
      processingError: m.processingError ?? null,
    };
  }

  private async unlinkSafe(p: string): Promise<void> {
    try { await fs.unlink(p); } catch { /* ignore */ }
  }

  private async rmDirSafe(p: string): Promise<void> {
    try { await fs.rm(p, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}
