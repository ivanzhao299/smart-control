import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, timingSafeEqual } from 'crypto';

export interface PlayerDeviceIdentity { id: string; slots: number[] }

/** Separate trust domain: these credentials never resolve to a user/admin Actor. */
@Injectable()
export class PlayerDeviceAuthService {
  constructor(private readonly config: ConfigService) {}

  authenticate(header: unknown, slot: number): PlayerDeviceIdentity {
    if (!Number.isInteger(slot) || slot < 1 || slot > 3) throw new ForbiddenException('无效设备通道');
    if (typeof header !== 'string' || header.length < 32 || header.length > 512) throw new UnauthorizedException('设备凭据无效');
    const digest = createHash('sha256').update(header).digest();
    // Only hashes are stored in server configuration. Rotation/revocation applies immediately.
    let entries: unknown;
    try { entries = JSON.parse(this.config.get<string>('PLAYER_DEVICE_CREDENTIALS') ?? '[]'); }
    catch { throw new UnauthorizedException('设备凭据配置不可用'); }
    if (!Array.isArray(entries) || entries.length > 32) throw new UnauthorizedException('设备凭据配置不可用');
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || entry.enabled !== true) continue;
      if (typeof entry.id !== 'string' || !/^[a-zA-Z0-9_-]{1,64}$/.test(entry.id)) continue;
      if (typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) continue;
      if (!Array.isArray(entry.slots) || !entry.slots.length || entry.slots.some((s: unknown) => !Number.isInteger(s) || Number(s) < 1 || Number(s) > 3)) continue;
      if (!timingSafeEqual(digest, Buffer.from(entry.sha256, 'hex'))) continue;
      if (!entry.slots.includes(slot)) throw new ForbiddenException('设备无权访问此通道');
      return { id: entry.id, slots: [...entry.slots] };
    }
    throw new UnauthorizedException('设备凭据无效');
  }
}
