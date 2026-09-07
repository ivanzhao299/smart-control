import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { AuthenticatedRequest, Actor, requireActor } from '../../common/auth/actor';
import { ClientAuthService } from '../client-auth/client-auth.service';
import { AdminAuthService } from '../admin-auth/admin-auth.service';
import { MediaService } from './media.service';

interface Ticket {
  mediaId: number;
  variant: 'file' | 'pdf';
  token: string;
  admin: boolean;
  expiresAt: number;
}

/** Opaque, bounded, short-lived capabilities; account and resource permission checked on every read. */
@Injectable()
export class MediaAccessService {
  private readonly tickets = new Map<string, Ticket>();
  constructor(private readonly media: MediaService,
    private readonly clients: ClientAuthService, private readonly admins: AdminAuthService) {}

  async issue(req: AuthenticatedRequest, mediaId: number, variant: 'file' | 'pdf') {
    const actor = requireActor(req);
    await this.media.authorized(mediaId, actor);
    const bearer = typeof req.headers.authorization === 'string' && req.headers.authorization.startsWith('Bearer ')
      ? req.headers.authorization.slice(7).trim() : '';
    const client = typeof req.headers['x-client-token'] === 'string' ? req.headers['x-client-token'].trim() : '';
    const token = actor.kind === 'admin' ? bearer : client || bearer;
    if (!token) throw new UnauthorizedException('请重新登录');
    const now = Date.now();
    for (const [key, value] of this.tickets) if (value.expiresAt <= now) this.tickets.delete(key);
    if (this.tickets.size >= 10000) this.tickets.delete(this.tickets.keys().next().value!);
    const key = randomBytes(32).toString('base64url');
    const expiresAt = now + 5 * 60 * 1000;
    this.tickets.set(key, { mediaId, variant, token, admin: actor.kind === 'admin', expiresAt });
    return { url: `/api/media/${mediaId}/stream?ticket=${key}`, expiresAt: new Date(expiresAt).toISOString() };
  }

  async redeem(key: string, mediaId: number): Promise<'file' | 'pdf'> {
    const ticket = this.tickets.get(key);
    if (!ticket || ticket.mediaId !== mediaId || ticket.expiresAt <= Date.now()) {
      if (ticket?.expiresAt && ticket.expiresAt <= Date.now()) this.tickets.delete(key);
      throw new UnauthorizedException('预览授权已过期，请重新打开资料');
    }
    let actor: Actor | null = null;
    if (ticket.admin) {
      if (await this.admins.verifyToken(ticket.token)) actor = { kind: 'admin', role: 'admin', userId: null, username: 'admin' };
    } else actor = await this.clients.resolveActor(ticket.token);
    if (!actor) { this.tickets.delete(key); throw new UnauthorizedException('登录已失效'); }
    await this.media.authorized(mediaId, actor);
    return ticket.variant;
  }

  async open(key: string, mediaId: number, range?: string) {
    const variant = await this.redeem(key, mediaId);
    const file = await this.media.openStream(mediaId, variant === 'pdf', range);
    try {
      // Opening/statting the file is asynchronous. Recheck expiry, session and
      // ownership before handing its descriptor to the HTTP response.
      await this.redeem(key, mediaId);
      return file;
    } catch (error) {
      file.stream?.destroy();
      throw error;
    }
  }
}
