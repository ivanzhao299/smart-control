import { Injectable, UnauthorizedException, ConflictException, BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';
import { relative, isAbsolute, extname } from 'path';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { MediaAsset } from '../../entities/media-asset.entity';
import { MediaQuotaService } from '../media/media-quota.service';
import { randomBytes } from 'crypto';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { User } from '../../entities/user.entity';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload, assertReadResource } from '../../common/auth/resource-policy';
import { PlaybackService } from './playback.service';
import { MediaService } from '../media/media.service';
import { PlayerDeviceAuthService } from './player-device-auth.service';

interface Grant { token: string; slot: number; mediaId: number; session: string; pdf: boolean; expires: number }

@Injectable()
export class PlayerDeviceAccessService {
  private readonly grants = new Map<string, Grant>();
  constructor(
    @InjectRepository(PlaybackChannel) private readonly channels: Repository<PlaybackChannel>,
    @InjectRepository(User) private readonly users: Repository<User>,
    private readonly devices: PlayerDeviceAuthService,
    private readonly playback: PlaybackService,
    private readonly media: MediaService,
    private readonly quota: MediaQuotaService,
  ) {}

  private session(row: PlaybackChannel): string {
    return row.playbackSession ?? '';
  }
  private async initiator(row: PlaybackChannel): Promise<Actor> {
    // Null is the separate administrator login; personal accounts always persist an ID.
    if (row.initiatorUserId === null) return { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
    const user = await this.users.findOneBy({ id: row.initiatorUserId });
    if (!user?.enabled) throw new UnauthorizedException('播放发起账户已停用');
    const actor: Actor = { kind: 'user', userId: user.id, username: user.username, role: user.role };
    assertCanUpload(actor);
    return actor;
  }

  async state(slot: number, token: string) {
    this.devices.authenticate(token, slot);
    const row = await this.channels.findOneByOrFail({ slot });
    const actor = await this.initiator(row);
    const view = await this.playback.getBySlot(slot, actor);
    const session = this.session(row);
    if (this.session(await this.channels.findOneByOrFail({ slot })) !== session) throw new ConflictException('播放状态已变化，请重试');
    if (view.currentMediaId !== row.currentMediaId) throw new ConflictException('播放状态变化或资料权限已撤销');
    if (row.currentMediaId !== null && view.currentMediaKind !== 'webpage' && view.currentMediaUrl) {
      const now = Date.now();
      for (const [key, grant] of this.grants) if (grant.expires <= now) this.grants.delete(key);
      let key: string | undefined;
      for (const [candidate, grant] of this.grants) {
        if (grant.token === token && grant.slot === slot && grant.session === session && grant.expires > now) {
          grant.expires = now + 300_000;
          key = candidate;
          break;
        }
      }
      if (!key) {
        while (this.grants.size >= 1000) this.grants.delete(this.grants.keys().next().value!);
        key = randomBytes(32).toString('base64url');
        this.grants.set(key, { token, slot, mediaId: row.currentMediaId, session, pdf: view.currentMediaKind === 'doc', expires: now + 300_000 });
      }
      view.currentMediaUrl = `/api/player-device/${slot}/stream?ticket=${key}`;
    }
    return { ...view, playbackSession: session };
  }

  private async authorizeStream(slot: number, ticket: string) {
    const grant = this.grants.get(ticket);
    if (!grant || grant.slot !== slot || grant.expires <= Date.now()) throw new UnauthorizedException('播放凭证已失效');
    this.devices.authenticate(grant.token, slot);
    const row = await this.channels.findOneByOrFail({ slot });
    if (this.session(row) !== grant.session || row.currentMediaId !== grant.mediaId) throw new UnauthorizedException('播放会话已变化');
    await this.media.authorized(grant.mediaId, await this.initiator(row));
    return grant;
  }

  async stream(slot: number, ticket: string, range?: string) {
    const grant = await this.authorizeStream(slot, ticket);
    const file = await this.media.openStream(grant.mediaId, grant.pdf, range);
    try {
      await this.authorizeStream(slot, ticket);
      return file;
    } catch (error) {
      file.stream?.destroy();
      throw error;
    }
  }

  async advance(slot: number, token: string, session: string) {
    this.devices.authenticate(token, slot);
    if (typeof session !== 'string' || !session) throw new ConflictException('缺少播放会话');
    const row = await this.channels.findOneByOrFail({ slot });
    if (this.session(row) !== session || row.currentMediaId === null || row.paused) throw new ConflictException('播放会话已变化或已暂停');
    const actor = await this.initiator(row);
    await this.playback.advance(slot, actor, session);
    return this.state(slot, token);
  }

  private async document(slot: number, token: string, session: string) {
    this.devices.authenticate(token, slot);
    const row = await this.channels.findOneByOrFail({ slot });
    if (!session || this.session(row) !== session || row.currentMediaId === null) throw new ConflictException('播放会话已变化');
    const media = await this.media.authorized(row.currentMediaId, await this.initiator(row));
    if (media.kind !== 'doc') throw new BadRequestException('当前资料不是文档');
    const root = await fs.realpath(this.media.mediaRoot);
    const path = await fs.realpath(this.media.absPathOf(media));
    const rel = relative(root, path);
    if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new BadRequestException('文档路径无效');
    return { media, root, path };
  }

  async docInfo(slot: number, token: string, session: string) {
    const { media, path } = await this.document(slot, token, session);
    return { id: media.id, ext: extname(path).slice(1).toLowerCase(), absPath: path, pageCount: media.pageCount, docPdfPath: media.docPdfPath };
  }

  async prepareDocument(slot: number, token: string, session: string) {
    const { media, path } = await this.document(slot, token, session);
    if (!['.doc', '.docx'].includes(extname(path).toLowerCase())) throw new BadRequestException('仅Word文档可转换');
    const pdfPath = path.slice(0, -extname(path).length) + '.pdf';
    try {
      await fs.lstat(pdfPath);
      throw new ConflictException('已有PDF文件，请先核实并恢复转换状态');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const maximum = Number(process.env.MEDIA_DOC_MAX_BYTES ?? 536870912);
    const reservation = await this.quota.reserveDocumentConversion(media.id, media.ownerUserId, maximum, this.media.mediaRoot, async (manager, current) => {
      await this.authorizeDocumentWrite(manager, current, slot, token, session, media.id);
      if (current.path !== media.path) throw new ConflictException('文档路径已变化');
    });
    return { id: media.id, reservationId: reservation.id, maxBytes: reservation.bytes, absPath: path, pdfPath };
  }

  async docMeta(slot: number, token: string, session: string, pageCount?: number, pdfReady?: boolean, reservationId?: string) {
    if (reservationId !== undefined && (typeof reservationId !== 'string' || !/^[0-9a-f-]{36}$/.test(reservationId) || !pdfReady)) throw new BadRequestException('无效文档转换预留');
    if (pageCount !== undefined && (!Number.isInteger(pageCount) || pageCount < 1 || pageCount > 100_000)) throw new BadRequestException('无效页数');
    if (pdfReady !== undefined && typeof pdfReady !== 'boolean') throw new BadRequestException('无效PDF状态');
    const { media, path, root } = await this.document(slot, token, session);
    let pdfRelPath: string | undefined;
    if (pdfReady) {
      if (!['.doc', '.docx'].includes(extname(path).toLowerCase())) throw new BadRequestException('仅Word文档可回写转换结果');
      const expected = path.slice(0, -extname(path).length) + '.pdf';
      const actual = await fs.realpath(expected);
      if (actual !== expected) throw new BadRequestException('PDF路径无效');
      pdfRelPath = relative(root, actual).replace(/\\/g, '/');
      const handle = await fs.open(actual, 'r');
      try {
        const header = Buffer.alloc(5);
        await handle.read(header, 0, 5, 0);
        if (header.toString() !== '%PDF-') throw new BadRequestException('转换结果不是PDF');
      } finally { await handle.close(); }
    }
    await this.document(slot, token, session);
    const updated = await this.media.setDocMeta(media.id, { pageCount, pdfRelPath }, async (manager, currentMedia) => {
      await this.authorizeDocumentWrite(manager, currentMedia, slot, token, session, media.id);
    }, reservationId);
    return { id: updated.id, pageCount: updated.pageCount };
  }

  private async authorizeDocumentWrite(manager: EntityManager, currentMedia: MediaAsset, slot: number, token: string, session: string, mediaId: number) {
      this.devices.authenticate(token, slot);
      const channel = await manager.findOneByOrFail(PlaybackChannel, { slot });
      if (this.session(channel) !== session || channel.currentMediaId !== mediaId) throw new ConflictException('播放会话已变化');
      let actor: Actor = { kind: 'admin', userId: null, username: 'admin', role: 'admin' };
      if (channel.initiatorUserId !== null) {
        const user = await manager.findOneBy(User, { id: channel.initiatorUserId, enabled: true });
        if (!user) throw new UnauthorizedException('播放发起账户已停用');
        actor = { kind: 'user', userId: user.id, username: user.username, role: user.role };
      }
      assertCanUpload(actor);
      assertReadResource(actor, currentMedia);
  }
}
