import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Repository } from 'typeorm';
import type { Actor } from '../../common/auth/actor';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { AuditLog } from '../../entities/audit-log.entity';
import { MediaAsset } from '../../entities/media-asset.entity';
import { SystemBranding } from '../../entities/system-branding.entity';
import { User } from '../../entities/user.entity';
import { brandingPatch } from './system-branding-config.dto';

/** One authoritative row, one CAS and audit transaction; no playback or file deletion. */
export async function writeSystemBranding(
  repository: Repository<SystemBranding>,
  input: unknown,
  actor: Actor,
  welcomeOnly = false,
  strict = false,
): Promise<SystemBranding> {
  const dto = brandingPatch(input, welcomeOnly, strict);
  const { expectedRevision, ...fields } = dto;
  const patch = Object.fromEntries(
    Object.entries(fields)
      .filter(([, v]) => v !== undefined)
      .map(([key, value]) => [key, typeof value === 'string' ? value.trim() || null : value]),
  );
  if (!Object.keys(patch).length)
    throw new BadRequestException({ code: 'SYSTEM_BRANDING_INVALID', message: '没有可保存的字段' });
  return serializedTransaction(repository.manager.connection, async (manager) => {
    if (!actor || actor.role !== 'admin' || actor.kind === 'legacy')
      throw new ForbiddenException('仅管理员可修改系统品牌和欢迎页');
    if (
      actor.kind === 'user' &&
      !(await manager.findOneBy(User, { id: actor.userId!, role: 'admin', enabled: true }))
    )
      throw new ForbiddenException('管理员权限已失效');
    const repo = manager.getRepository(SystemBranding);
    const before = await repo.findOneBy({ id: 1 });
    if (!before)
      throw new ConflictException({
        code: 'SYSTEM_BRANDING_MISSING',
        message: '品牌权威记录缺失，请恢复数据库，未执行保存',
      });
    const conflict = () =>
      new ConflictException({
        code: 'SYSTEM_BRANDING_REVISION_CONFLICT',
        message: '配置已被修改，请保留草稿并重新读取',
      });
    if (expectedRevision !== undefined && expectedRevision !== before.configRevision)
      throw conflict();
    const changes = Object.fromEntries(
      Object.entries(patch).filter(([k, v]) => before[k as keyof SystemBranding] !== v),
    );
    if (!Object.keys(changes).length) return before;
    for (const key of ['welcomeMediaId', 'welcomeBgMediaId', 'welcomePhotoMediaId']) {
      const id = changes[key];
      if (id === undefined || id === null) continue;
      const media = await manager.findOneBy(MediaAsset, { id: id as number });
      if (
        !media ||
        media.processingStatus !== 'ready' ||
        (key !== 'welcomeMediaId' && media.kind !== 'image')
      )
        throw new BadRequestException({
          code: 'SYSTEM_BRANDING_MEDIA_INVALID',
          message: '绑定媒体不存在、未就绪或不是图片',
        });
    }
    if (
      !Number.isSafeInteger(before.configRevision) ||
      before.configRevision < 1 ||
      before.configRevision >= Number.MAX_SAFE_INTEGER
    )
      throw new ConflictException({
        code: 'SYSTEM_BRANDING_REVISION_INVALID',
        message: '配置版本异常，请检查数据库',
      });
    if (
      (
        await repo.update(
          { id: 1, configRevision: before.configRevision },
          { ...changes, configRevision: before.configRevision + 1 },
        )
      ).affected !== 1
    )
      throw conflict();
    const saved = await repo.findOneByOrFail({ id: 1 });
    const snapshot = (row: SystemBranding) => {
      // Explicit allowlist: no legacy layout snapshot, photo bytes, data URL, URL token or file path.
      const {
        systemName,
        systemSubtitle,
        logoText,
        browserTitle,
        copyright,
        welcomeMediaId,
        welcomeGuest,
        welcomeTitle,
        welcomeTagline,
        welcomeBgMediaId,
        welcomePhotoMediaId,
        configRevision,
      } = row;
      return JSON.stringify({
        systemName,
        systemSubtitle,
        logoText,
        browserTitle,
        copyright,
        welcomeMediaId,
        welcomeGuest,
        welcomeTitle,
        welcomeTagline,
        welcomeBgMediaId,
        welcomePhotoMediaId,
        configRevision,
        logoSha256: row.logoUrl ? createHash('sha256').update(row.logoUrl).digest('hex') : null,
      });
    };
    await manager.insert(AuditLog, {
      entityType: 'system_branding',
      entityId: '1',
      action: 'update',
      operator: actor.username,
      snapshotBefore: snapshot(before),
      snapshotAfter: snapshot(saved),
      remark: welcomeOnly ? 'welcome-config:write' : 'system-branding:write',
    });
    return saved;
  });
}
