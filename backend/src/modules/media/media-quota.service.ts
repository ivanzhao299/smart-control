import { Injectable, BadRequestException, ForbiddenException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { Actor } from '../../common/auth/actor';
import { assertCanUpload } from '../../common/auth/resource-policy';
import { serializedTransaction } from '../../common/utils/serialized-transaction';
const uploadInstance = randomUUID();
const uploadProcess = Object.freeze({ host: hostname(), pid: process.pid, startedAt: new Date(Date.now() - process.uptime() * 1000).toISOString() });

@Injectable()
export class MediaQuotaService {
  constructor(private readonly db: DataSource) {}

  async bindTemporary(actor: Actor, id: string | null, name: string): Promise<void> {
    assertCanUpload(actor);
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.upload$/.test(name)) throw new BadRequestException('无效临时文件名');
    if (actor.userId === null && id === null) return;
    if (actor.userId === null || !id) throw new ForbiddenException('上传预留不存在');
    await serializedTransaction(this.db, async manager => {
      // Register together with the binding; a failed binding leaves no new record.
      // Metadata is evidence only: hostname/PID reuse must never trigger cleanup.
      await manager.query('INSERT OR IGNORE INTO upload_instances (id, hostname, pid, started_at) VALUES (?, ?, ?, ?)',
        [uploadInstance, uploadProcess.host, uploadProcess.pid, uploadProcess.startedAt]);
      const result = await manager.createQueryBuilder().update('upload_reservations')
        .set({ temp_name: name, instance_id: uploadInstance })
        .where('id = :id AND owner_user_id = :owner AND temp_name IS NULL AND instance_id IS NULL', { id, owner: actor.userId })
        .andWhere("EXISTS (SELECT 1 FROM users WHERE users.id = :owner AND enabled = 1 AND role IN ('admin', 'operator'))", { owner: actor.userId }).execute();
      if (!result.affected) throw new ForbiddenException('上传预留不存在、已绑定或账户已无上传权限');
    });
  }

  async reserve(actor: Actor, bytes: number): Promise<string | null> {
    assertCanUpload(actor);
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new BadRequestException('无效文件大小');
    // Separate system-admin login has no personal quota; global disk guard remains separate.
    if (actor.userId === null) return null;
    const id = randomUUID();
    return serializedTransaction(this.db, async (manager) => {
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
    if (!id || actor.userId === null) return;
    await serializedTransaction(this.db, (manager) =>
      manager.query('DELETE FROM upload_reservations WHERE id = ? AND owner_user_id = ?', [
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
