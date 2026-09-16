import { MigrationInterface, QueryRunner } from 'typeorm';
import catalog from './catalogs/hvac-playback-catalog-v1.json';

/**
 * Establish fresh-install HVAC metadata and physical playback channels once.
 * A non-empty table is administrator-owned and is left byte-for-byte unchanged,
 * including intentionally partial or disabled catalogs.
 */
export class EstablishHvacPlaybackCatalog1789670000000 implements MigrationInterface {
  name = 'EstablishHvacPlaybackCatalog1789670000000';

  async up(q: QueryRunner): Promise<void> {
    if (await this.isEmpty(q, 'hvac_zone')) {
      for (const zone of catalog.zones) {
        await q.query(
          `INSERT INTO hvac_zone
           (code, name, floor, indoors, sort_order, description, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            zone.code,
            zone.name,
            zone.floor,
            '[]',
            zone.sortOrder,
            zone.description,
          ],
        );
      }
    }

    if (await this.isEmpty(q, 'hvac_indoor')) {
      for (const indoor of catalog.indoors) {
        await q.query(
          `INSERT INTO hvac_indoor
           (idx, name, floor, zone_code, model, sort_order, enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [indoor.idx, indoor.name, indoor.floor, indoor.zoneCode, indoor.model, indoor.sortOrder],
        );
      }
    }

    if (await this.isEmpty(q, 'playback_channels')) {
      for (const channel of catalog.playbackChannels) {
        await q.query(
          `INSERT INTO playback_channels
           (playback_session, initiator_user_id, slot, name, outputKind, currentMediaId,
            currentPlaylistId, playlistIndex, startedAt, loopMode, playMode, displayFit,
            docPage, docZoom, paused, lastHeartbeatAt, updatedAt)
           VALUES (NULL, NULL, ?, ?, ?, NULL, NULL, 0, NULL, 'once', 'loopAll', 'fill',
                   1, 100, 0, NULL, CURRENT_TIMESTAMP)`,
          [channel.slot, channel.name, channel.outputKind],
        );
      }
    }
  }

  async down(): Promise<void> {
    throw new Error('HVAC_PLAYBACK_CATALOG_ROLLBACK_REQUIRES_ARCHIVE');
  }

  private async isEmpty(q: QueryRunner, table: string): Promise<boolean> {
    const [row] = (await q.query(`SELECT COUNT(*) AS count FROM "${table}"`)) as Array<{
      count: number | string;
    }>;
    return Number(row.count) === 0;
  }
}
