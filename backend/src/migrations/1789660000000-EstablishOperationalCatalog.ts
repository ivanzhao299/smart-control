import { MigrationInterface, QueryRunner } from 'typeorm';
import catalog from './catalogs/operational-catalog-v1.json';

type Row = Record<string, unknown>;
interface CatalogAction {
  deviceType: string;
  deviceId: string;
  command: string;
  params?: Record<string, unknown>;
  delayMs?: number;
}

/**
 * Freeze the former deployment seed as a one-time, versioned catalog migration.
 * Existing rows are never overwritten. Historical corrections use exact old
 * signatures, and rollback requires a matched archive because these tables are
 * authoritative site configuration and operating history.
 */
export class EstablishOperationalCatalog1789660000000 implements MigrationInterface {
  name = 'EstablishOperationalCatalog1789660000000';

  async up(q: QueryRunner): Promise<void> {
    await this.establishScenes(q);
    await this.establishSceneActions(q);
    await this.establishDevices(q);
    await this.establishHardware(q);
    await this.applyExactHardwareRepairs(q);
    await this.establishLighting(q);
    await this.establishUat(q);
  }

  async down(): Promise<void> {
    throw new Error('OPERATIONAL_CATALOG_ROLLBACK_REQUIRES_ARCHIVE');
  }

  private async establishScenes(q: QueryRunner): Promise<void> {
    for (const scene of catalog.SCENES) {
      await q.query(
        `INSERT OR IGNORE INTO scenes
         (code, name, description, enabled, created_at, updated_at)
         VALUES (?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [scene.code, scene.name, scene.description],
      );
    }
  }

  private async establishSceneActions(q: QueryRunner): Promise<void> {
    for (const [code, actions] of Object.entries(catalog.SCENE_ACTIONS)) {
      const scenes = (await q.query('SELECT id FROM scenes WHERE code = ?', [code])) as Array<{
        id: number;
      }>;
      if (scenes.length !== 1) continue;
      const [{ count }] = (await q.query(
        'SELECT COUNT(*) AS count FROM scene_actions WHERE scene_id = ?',
        [scenes[0].id],
      )) as Array<{ count: number }>;
      if (Number(count) !== 0) continue;
      for (let index = 0; index < actions.length; index += 1) {
        const action = actions[index] as CatalogAction;
        await q.query(
          `INSERT INTO scene_actions
           (scene_id, device_type, device_id, command, params, delay_ms, sort_order,
            enabled, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            scenes[0].id,
            action.deviceType,
            action.deviceId,
            action.command,
            JSON.stringify(action.params ?? {}),
            action.delayMs ?? 0,
            index + 1,
          ],
        );
      }
    }
  }

  private async establishDevices(q: QueryRunner): Promise<void> {
    for (const device of catalog.DEVICES) {
      await q.query(
        `INSERT OR IGNORE INTO devices
         (name, category, protocol, adapter, ip, address, floor, zone, enabled, status,
          debug_remark, last_test_at, last_test_result, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 1, 'offline', NULL, NULL, NULL,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          device.name,
          device.category,
          device.protocol,
          device.adapter,
          device.address ?? null,
          device.floor,
          device.zone,
        ],
      );
    }
  }

  private async establishHardware(q: QueryRunner): Promise<void> {
    for (const hardware of catalog.HARDWARE) {
      await q.query(
        `INSERT OR IGNORE INTO hardware_units
         (code, name, category, vendor, model, driverKind, serialNo, firmwareVersion,
          location, floor, ip, macAddress, addressing, channels, status, enabled, remark,
          installedAt, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, NULL, ?, ?, 'normal', 1, ?, NULL,
                 CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [
          hardware.code,
          hardware.name,
          hardware.category,
          hardware.vendor,
          hardware.model,
          hardware.driverKind ?? null,
          hardware.location ?? null,
          hardware.floor ?? null,
          hardware.ip ?? null,
          hardware.addressing ?? null,
          hardware.channels ?? null,
          hardware.remark ?? null,
        ],
      );
    }
  }

  private async applyExactHardwareRepairs(q: QueryRunner): Promise<void> {
    for (const fix of catalog.HW_IP_FIXES) {
      await q.query(
        'UPDATE hardware_units SET ip = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND ip = ?',
        [fix.newIp, fix.code, fix.oldIp],
      );
    }
    for (const fix of catalog.HW_MODEL_FIXES) {
      await q.query(
        'UPDATE hardware_units SET model = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ? AND model = ?',
        [fix.newModel, fix.code, fix.oldModel],
      );
    }
    for (const fix of catalog.HW_DRIVER_FIXES) {
      await q.query(
        `UPDATE hardware_units SET driverKind = ?, updated_at = CURRENT_TIMESTAMP
         WHERE code = ? AND (driverKind IS NULL OR trim(driverKind) = '')`,
        [fix.driverKind, fix.code],
      );
    }
    for (const fix of catalog.DALI_GROUP_FIXES) {
      const rows = (await q.query('SELECT addressing FROM hardware_units WHERE code = ?', [
        fix.code,
      ])) as Array<{ addressing: string | null }>;
      if (!rows[0]?.addressing) continue;
      let addressing: Row;
      try {
        addressing = JSON.parse(rows[0].addressing) as Row;
      } catch {
        continue;
      }
      if (Array.isArray(addressing.groups) && addressing.groups.length > 0) continue;
      addressing.groups = fix.groups;
      await q.query(
        'UPDATE hardware_units SET addressing = ?, updated_at = CURRENT_TIMESTAMP WHERE code = ?',
        [JSON.stringify(addressing), fix.code],
      );
    }
  }

  private async establishLighting(q: QueryRunner): Promise<void> {
    for (const zone of catalog.ZONES) {
      await q.query(
        `INSERT OR IGNORE INTO light_zone
         (code, name, floor, gateway_code, dali_group, sort_order, icon, description,
          enabled, created_at, updated_at)
         VALUES (?, ?, '1F', NULL, NULL, ?, ?, NULL, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [zone.code, zone.name, zone.sortOrder, zone.icon ?? 'Lightbulb'],
      );
    }
    for (const group of catalog.GROUPS) {
      await q.query(
        `INSERT OR IGNORE INTO light_group
         (gateway_code, dali_group, zone_code, shorts, sort_order, enabled,
          created_at, updated_at)
         VALUES (?, ?, ?, NULL, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [group.gatewayCode, group.daliGroup, group.zoneCode, group.sortOrder],
      );
    }
  }

  private async establishUat(q: QueryRunner): Promise<void> {
    for (let index = 0; index < catalog.UAT_ITEMS.length; index += 1) {
      const item = catalog.UAT_ITEMS[index];
      await q.query(
        `INSERT OR IGNORE INTO uat_records
         (item_name, category, test_step, expected_result, actual_result, status, tester,
          remark, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, 'pending', NULL, NULL, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
        [item.itemName, item.category, item.testStep, item.expectedResult, index + 1],
      );
    }
  }
}
