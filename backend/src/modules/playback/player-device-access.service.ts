import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { PlaybackChannel } from '../../entities/playback-channel.entity';
import { User } from '../../entities/user.entity';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';
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
        if (grant.token === token && grant.slot === slot && grant.session === session && grant.expires > now + 60_000) { key = candidate; break; }
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

  async stream(slot: number, ticket: string, range?: string) {
    const grant = this.grants.get(ticket);
    if (!grant || grant.slot !== slot || grant.expires <= Date.now()) throw new UnauthorizedException('播放凭证已失效');
    this.devices.authenticate(grant.token, slot);
    const row = await this.channels.findOneByOrFail({ slot });
    if (this.session(row) !== grant.session || row.currentMediaId !== grant.mediaId) throw new UnauthorizedException('播放会话已变化');
    await this.media.authorized(grant.mediaId, await this.initiator(row));
    return this.media.openStream(grant.mediaId, grant.pdf, range);
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
}
