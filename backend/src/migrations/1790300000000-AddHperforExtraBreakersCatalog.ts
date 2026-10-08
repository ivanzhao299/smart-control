import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add three more HPERFOR cloud-web breakers (2026-10-08).
 *
 * Purely additive and idempotent: reuses the existing `hperfor-web` driver
 * template created by AddHperforWebBreakersCatalog (no new driver row) and adds
 * three ePa-CB 4G breakers plus their circuits:
 *   - 楼顶大字 (CB28100586)
 *   - 路灯2   (CB28100585)
 *   - 路灯3   (CB28100571)
 * Same control path as the first three (HPERFOR cloud Web API, category
 * power-breaker-web). Every statement uses WHERE NOT EXISTS so all sites
 * converge without touching existing rows.
 */

interface HperforUnit {
  code: string;
  name: string;
  serialNo: string;
  fId: string;
  lat: number;
  lng: number;
  location: string;
}

interface HperforCircuit {
  code: string;
  name: string;
  category: string;
  gatewayCode: string;
  ratedVoltage: number;
  ratedCurrent: number;
  ratedPower: number;
  sortOrder: number;
  icon: string;
  description: string;
}

const UNITS: HperforUnit[] = [
  {
    code: 'CB4G-SIGN-1',
    name: '楼顶大字 4G 断路器',
    serialNo: 'CB28100586',
    fId: '2108034374871126017',
    lat: 35.06847,
    lng: 118.18683,
    location: '园区楼顶',
  },
  {
    code: 'CB4G-ROAD-2',
    name: '路灯2 4G 断路器',
    serialNo: 'CB28100585',
    fId: '2108030517168410626',
    lat: 35.06853,
    lng: 118.1868,
    location: '园区道路',
  },
  {
    code: 'CB4G-ROAD-3',
    name: '路灯3 4G 断路器',
    serialNo: 'CB28100571',
    fId: '2108031188101861378',
    lat: 35.0684,
    lng: 118.18678,
    location: '园区道路',
  },
];

const CIRCUITS: HperforCircuit[] = [
  {
    code: 'roof-sign',
    name: '楼顶大字',
    category: 'lighting',
    gatewayCode: 'CB4G-SIGN-1',
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 3000,
    sortOrder: 230,
    icon: 'Lightbulb',
    description: '楼顶发光大字, 华普云 4G 断路器远程控制',
  },
  {
    code: 'streetlight-2',
    name: '路灯2',
    category: 'lighting',
    gatewayCode: 'CB4G-ROAD-2',
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 3000,
    sortOrder: 240,
    icon: 'Lightbulb',
    description: '园区道路照明 2 号回路, 华普云 4G 断路器远程控制',
  },
  {
    code: 'streetlight-3',
    name: '路灯3',
    category: 'lighting',
    gatewayCode: 'CB4G-ROAD-3',
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 3000,
    sortOrder: 250,
    icon: 'Lightbulb',
    description: '园区道路照明 3 号回路, 华普云 4G 断路器远程控制',
  },
];

export class AddHperforExtraBreakersCatalog1790300000000 implements MigrationInterface {
  name = 'AddHperforExtraBreakersCatalog1790300000000';

  async up(q: QueryRunner): Promise<void> {
    // 1) Hardware units (hardware_units uses camelCase quoted columns)
    for (const u of UNITS) {
      const addressing = JSON.stringify({
        fId: u.fId,
        password: '0',
        lat: u.lat,
        lng: u.lng,
      });
      await q.query(
        `INSERT INTO hardware_units
         (code, name, category, vendor, model, "driverKind", "serialNo",
          "firmwareVersion", location, floor, ip, "macAddress", addressing, channels,
          status, enabled, remark, "installedAt", created_at, updated_at)
         SELECT ?, ?, 'power-breaker-web', 'ePa', 'ePa-CB (内置 4G)', 'hperfor-web', ?,
                NULL, ?, '园区', NULL, NULL, ?, NULL,
                'normal', 1, NULL, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM hardware_units WHERE code = ?)`,
        [u.code, u.name, u.serialNo, u.location, addressing, u.code],
      );
    }

    // 2) Power circuits (power_circuit uses snake_case columns)
    for (const c of CIRCUITS) {
      await q.query(
        `INSERT INTO power_circuit
         (code, name, floor, category, gateway_code, relay_channel, meter_address,
          rated_voltage, rated_current, rated_power, sort_order, icon, description, enabled,
          created_at, updated_at)
         SELECT ?, ?, '园区', ?, ?, NULL, NULL, ?, ?, ?, ?, ?, ?, 1,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
         WHERE NOT EXISTS (SELECT 1 FROM power_circuit WHERE code = ?)`,
        [
          c.code, c.name, c.category, c.gatewayCode,
          c.ratedVoltage, c.ratedCurrent, c.ratedPower,
          c.sortOrder, c.icon, c.description, c.code,
        ],
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const [{ scheduleCount }] = (await q.query(
      `SELECT COUNT(*) AS scheduleCount FROM power_schedules ps
       JOIN power_circuit pc ON pc.id = ps.circuit_id
       WHERE pc.code IN ('roof-sign','streetlight-2','streetlight-3')`,
    )) as Array<{ scheduleCount: number }>;
    if (Number(scheduleCount) > 0) {
      throw new Error('HPERFOR_EXTRA_CATALOG_ROLLBACK_REQUIRES_SCHEDULE_REMOVAL');
    }
    for (const c of CIRCUITS) {
      await q.query(`DELETE FROM power_circuit WHERE code = ?`, [c.code]);
    }
    for (const u of UNITS) {
      await q.query(`DELETE FROM hardware_units WHERE code = ?`, [u.code]);
    }
  }
}
