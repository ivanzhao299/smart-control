import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { promises as fs } from 'fs';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
import { MediaAsset } from '../../entities/media-asset.entity';
const uploadInstance = randomUUID();
const uploadProcess = Object.freeze({ host: hostname(), pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() });

@Injectable()
export class MediaQuotaService {
  constructor(private readonly db: DataSource) {}

  private async availableDiskBytes(mediaRoot?: string): Promise<number> {
    const root = mediaRoot ?? process.env.MEDIA_ROOT ?? (process.platform === 'win32' ? 'D:\\Media' : '/var/lib/smart-control/media');
    const margin = Number(process.env.MEDIA_DISK_RESERVE_BYTES ?? 512 * 1024 ** 2);
    if (!Number.isSafeInteger(margin) || margin < 0) throw new BadRequestException('无效磁盘安全余量');
    const stat = await fs.statfs(root, { bigint: true });
    if (stat.bsize <= 0n || stat.bavail < 0n) throw new ForbiddenException('无法核验媒体磁盘可用空间');
    const remaining = stat.bsize * stat.bavail - BigInt(margin);
    return remaining <= 0n ? 0 : Number(remaining > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : remaining);
  }

  private async remainingDisk(manager: EntityManager, mediaRoot?: string): Promise<number> {
    const available = await this.availableDiskBytes(mediaRoot);
    const [row] = await manager.query('SELECT COALESCE(SUM(bytes), 0) AS reserved FROM upload_reservations');
    const reserved = Number(row.reserved);
    if (!Number.isSafeInteger(reserved) || reserved < 0) throw new ForbiddenException('磁盘预留账目异常');
    // Conservative: partially written reservations remain fully charged until
    // released, even though statfs already reflects their written bytes.
    return Math.max(0, available - reserved);
  }

  async reserveConversion(mediaId: number, expectedOwner: number | null, maximum: number, mediaRoot?: string): Promise<{ id: string | null; bytes: number }> {
    if (!Number.isSafeInteger(maximum) || maximum < 1) throw new BadRequestException('无效转码容量预算');
    return serializedTransaction(this.db, async manager => {
      const asset = await manager.findOneByOrFail(MediaAsset, { id: mediaId });
      if (asset.ownerUserId !== expectedOwner || asset.processingStatus !== 'processing') throw new ForbiddenException('转码资料状态或归属已变化');
      const disk = await this.remainingDisk(manager, mediaRoot);
      if (disk < 1) throw new ForbiddenException('媒体磁盘可用空间不足');
      const [capacity] = await manager.query(`SELECT storage_quota_bytes
        - COALESCE((SELECT SUM(sizeBytes) FROM media_assets WHERE owner_user_id = users.id), 0)
        - COALESCE((SELECT SUM(bytes) FROM upload_reservations WHERE owner_user_id = users.id), 0) AS available
        FROM users WHERE id = ? AND enabled = 1 AND role IN ('admin', 'operator')`, [expectedOwner]);
      const available = Number(capacity?.available);
      if (expectedOwner !== null && (!Number.isSafeInteger(available) || available < 1)) throw new ForbiddenException('转码存储配额不足或账户已停用');
      const bytes = Math.min(disk, expectedOwner === null ? maximum : Math.min(maximum, available));
      const id = randomUUID();
      await manager.query(`INSERT INTO upload_reservations (id, owner_user_id, bytes, target_media_id)
        SELECT ?, ?, ?, ? WHERE NOT EXISTS
        (SELECT 1 FROM upload_reservations WHERE target_media_id = ? AND temp_name IS NULL)`, [id, expectedOwner, bytes, mediaId, mediaId]);
      if (!(await manager.query('SELECT id FROM upload_reservations WHERE id = ?', [id])).length) throw new ForbiddenException('资料已有待恢复转码预留');
      return { id, bytes };
    });
  }

  async releaseConversion(id: string | null, mediaId: number): Promise<void> {
    if (!id) return;
    await serializedTransaction(this.db, manager => manager.query(
      'DELETE FROM upload_reservations WHERE id = ? AND target_media_id = ? AND temp_name IS NULL', [id, mediaId]));
  }

  async bindTemporary(actor: Actor, id: string | null, name: string): Promise<void> {
    assertCanUpload(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.upload$/.test(name)) throw new BadRequestException('无效临时文件名');
    if (!id) throw new ForbiddenException('上传预留不存在');
    await serializedTransaction(this.db, async manager => {
      // Register together with the binding; a failed binding leaves no new record.
      // Metadata is evidence only: hostname/PID reuse must never trigger cleanup.
      await manager.query('INSERT OR IGNORE INTO upload_instances (id, hostname, pid, started_at) VALUES (?, ?, ?, ?)',
        [uploadInstance, uploadProcess.host, uploadProcess.pid, uploadProcess.startedAt]);
      const result = await manager.createQueryBuilder().update('upload_reservations')
        .set({ temp_name: name, instance_id: uploadInstance })
        .where('id = :id AND owner_user_id IS :owner AND temp_name IS NULL AND instance_id IS NULL AND target_media_id IS NULL', { id, owner: actor.userId })
        .andWhere("(:owner IS NULL OR EXISTS (SELECT 1 FROM users WHERE users.id = :owner AND enabled = 1 AND role IN ('admin', 'operator')))", { owner: actor.userId }).execute();
      if (!result.affected) throw new ForbiddenException('上传预留不存在、已绑定或账户已无上传权限');
    });
  }

  async shrinkUnbound(actor: Actor, id: string, bytes: number): Promise<void> {
    assertCanUpload(actor);
    if (!Number.isSafeInteger(bytes) || bytes < 1) throw new BadRequestException('无效实际下载大小');
    await serializedTransaction(this.db, async manager => {
      const result = await manager.createQueryBuilder().update('upload_reservations').set({ bytes })
        .where('id = :id AND owner_user_id IS :owner AND bytes >= :bytes AND temp_name IS NULL AND target_media_id IS NULL', { id, owner: actor.userId, bytes })
        .andWhere("(:owner IS NULL OR EXISTS (SELECT 1 FROM users WHERE id = :owner AND enabled = 1 AND role IN ('admin', 'operator')))", { owner: actor.userId }).execute();
      if (!result.affected) throw new ForbiddenException('下载预留已失效或实际大小超出预留');
    });
  }

  async reserve(actor: Actor, bytes: number, mediaRoot?: string): Promise<string | null> {
    assertCanUpload(actor);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new BadRequestException('无效文件大小');
    const id = randomUUID();
    return serializedTransaction(this.db, async (manager) => {
      if (bytes > await this.remainingDisk(manager, mediaRoot)) throw new ForbiddenException('媒体磁盘可用空间不足');
      if (actor.userId === null) {
        await manager.query('INSERT INTO upload_reservations (id, owner_user_id, bytes) VALUES (?, NULL, ?)', [id, bytes]);
        return id;
      }
      // A single INSERT...SELECT holds SQLite's writer lock for both check and reserve.
      // No await between a read of free bytes and the write that consumes them.
      await manager.query(
        `INSERT INTO upload_reservations (id, owner_user_id, bytes)
      SELECT ?, u.id, ? FROM users u
      WHERE u.id = ? AND u.enabled = 1 AND u.role IN ('admin', 'operator')
      AND ? <= u.storage_quota_bytes
        - COALESCE((SELECT SUM(m.sizeBytes) FROM media_assets m WHERE m.owner_user_id = u.id), 0)
        - COALESCE((SELECT SUM(r.bytes) FROM upload_reservations r WHERE r.owner_user_id = u.id), 0)`,
        [id, bytes, actor.userId, bytes],
      );
      const rows = await manager.query('SELECT id FROM upload_reservations WHERE id = ?', [id]);
      if (!rows.length) throw new ForbiddenException('存储配额不足或账户已无上传权限');
      return id;
    });
  }

  async release(actor: Actor, id: string | null): Promise<void> {
    if (!id) return;
    await serializedTransaction(this.db, (manager) =>
      manager.query('DELETE FROM upload_reservations WHERE id = ? AND owner_user_id IS ?', [
        id,
        actor.userId,
      ]),
    );
  }

  async usage(actor: Actor) {
    if (actor.userId === null) return { quotaBytes: null, usedBytes: null, reservedBytes: null };
    return serializedTransaction(this.db, async (manager) => {
      const [row] = await manager.query(
        `SELECT storage_quota_bytes AS quotaBytes,
      COALESCE((SELECT SUM(sizeBytes) FROM media_assets WHERE owner_user_id = users.id), 0) AS usedBytes,
      COALESCE((SELECT SUM(bytes) FROM upload_reservations WHERE owner_user_id = users.id), 0) AS reservedBytes
      FROM users WHERE id = ?`,
        [actor.userId],
      );
      if (!row) throw new ForbiddenException('账户不存在');
      return row;
    });
  }

  async setLimit(actor: Actor, userId: number, bytes: number): Promise<void> {
    if (actor.role !== 'admin') throw new ForbiddenException('仅管理员可修改配额');
    if (!Number.isSafeInteger(userId) || userId < 1 || !Number.isSafeInteger(bytes) || bytes < 0)
      throw new BadRequestException('无效配额参数');
    // Cannot lower beneath committed and in-flight storage, including concurrent reservations.
    await serializedTransaction(this.db, async (manager) => {
      if (actor.kind === 'user') {
        const [current] = await manager.query('SELECT id FROM users WHERE id = ? AND enabled = 1 AND role = ?', [actor.userId, 'admin']);
        if (!current) throw new ForbiddenException('管理员权限已失效');
      } else if (actor.kind !== 'admin' || actor.userId !== null) {
        throw new ForbiddenException('仅管理员可修改配额');
      }
      const result = await manager
        .createQueryBuilder()
        .update('users')
        .set({ storageQuotaBytes: bytes })
        .where('id = :id', { id: userId })
        .andWhere(
          `:bytes >= COALESCE((SELECT SUM(sizeBytes) FROM media_assets WHERE owner_user_id = :id), 0)
        + COALESCE((SELECT SUM(bytes) FROM upload_reservations WHERE owner_user_id = :id), 0)`,
          { bytes, id: userId },
        )
        .execute();
      if (!result.affected) throw new BadRequestException('用户不存在或新配额低于已用及预留容量');
    });
  }
}
