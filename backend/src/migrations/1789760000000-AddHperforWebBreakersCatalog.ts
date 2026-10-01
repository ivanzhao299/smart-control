import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add HPERFOR cloud-web breakers catalog (2026-10-01).
 *
 * Purely additive: a new driver template + three ePa-CB 4G breakers
 * (courtyard lighting / pond aeration / park streetlight) and their circuits.
 * These devices are driven through the HPERFOR cloud Web API (category
 * power-breaker-web), not Modbus and not the MQTT 4G route. Every statement is
 * idempotent (WHERE NOT EXISTS) so all installed sites converge without touching
 * existing rows.
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
    code: 'CB4G-LIGHT-1',
    name: '庭院亮化 4G 断路器',
    serialNo: 'CB28100573',
    fId: '2105527243374694401',
    lat: 35.068466,
    lng: 118.18683,
    location: '园区庭院',
  },
  {
    code: 'CB4G-OXY-1',
    name: '鱼池供氧 4G 断路器',
    serialNo: 'CB28100574',
    fId: '2105527756560371714',
    lat: 35.06846,
    lng: 118.18679,
    location: '园区鱼池',
  },
  {
    code: 'CB4G-ROAD-1',
    name: '园区路灯 4G 断路器',
    serialNo: 'CB28100572',
    fId: '2105528302251905025',
    lat: 35.068527,
    lng: 118.1868,
    location: '园区道路',
  },
];

const CIRCUITS: HperforCircuit[] = [
  {
    code: 'courtyard-light',
    name: '庭院亮化',
    category: 'lighting',
    gatewayCode: 'CB4G-LIGHT-1',
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 2200,
    sortOrder: 200,
    icon: 'Lightbulb',
    description: '庭院景观照明, 华普云 4G 断路器远程控制',
  },
  {
    code: 'pond-aeration',
    name: '鱼池供氧',
    category: 'misc',
    gatewayCode: 'CB4G-OXY-1',
    ratedVoltage: 220,
    ratedCurrent: 10,
    ratedPower: 500,
    sortOrder: 210,
    icon: 'Waves',
    description: '鱼池增氧泵, 华普云 4G 断路器远程控制',
  },
  {
    code: 'park-streetlight',
    name: '园区路灯',
    category: 'lighting',
    gatewayCode: 'CB4G-ROAD-1',
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 3000,
    sortOrder: 220,
    icon: 'Lightbulb',
    description: '园区道路照明, 华普云 4G 断路器远程控制',
  },
];

export class AddHperforWebBreakersCatalog1789760000000 implements MigrationInterface {
  name = 'AddHperforWebBreakersCatalog1789760000000';

  async up(q: QueryRunner): Promise<void> {
    // 1) Driver template (camelCase quoted columns on driver_templates)
    const capabilities = ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'];
    const defaultAddressing = { fId: '', password: '0' };
    const paramSchema = {
      fId: {
        type: 'string',
        label: '华普云设备 ID (fId)',
        required: true,
        placeholder: '平台设备详情中的 fId',
      },
      password: {
        type: 'string',
        label: '设备本地密码',
        required: false,
        default: '0',
        placeholder: '默认 0',
      },
    };
    await q.query(
      `INSERT INTO driver_templates
       (kind, "displayName", vendor, category, protocol, "capabilitiesJson",
        "defaultAddressingJson", "paramSchemaJson", remark, builtin, enabled,
        created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE NOT EXISTS (SELECT 1 FROM driver_templates WHERE kind = ?)`,
      [
        'hperfor-web',
        'ePa 4G 智能断路器 (华普云 Web API)',
        'ePa',
        'power-breaker-web',
        'http-json',
        JSON.stringify(capabilities),
        JSON.stringify(defaultAddressing),
        JSON.stringify(paramSchema),
        '庭院亮化、鱼池供氧、园区路灯等 4G 回路；经华普云平台 Web API 登录后下发分/合闸，不经过本地 broker。',
        'hperfor-web',
      ],
    );

    // 2) Hardware units (hardware_units uses camelCase quoted columns)
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

    // 3) Power circuits (power_circuit uses snake_case columns)
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
       WHERE pc.code IN ('courtyard-light','pond-aeration','park-streetlight')`,
    )) as Array<{ scheduleCount: number }>;
    if (Number(scheduleCount) > 0) {
      throw new Error('HPERFOR_CATALOG_ROLLBACK_REQUIRES_SCHEDULE_REMOVAL');
    }
    for (const c of CIRCUITS) {
      await q.query(`DELETE FROM power_circuit WHERE code = ?`, [c.code]);
    }
    for (const u of UNITS) {
      await q.query(`DELETE FROM hardware_units WHERE code = ?`, [u.code]);
    }
    await q.query(`DELETE FROM driver_templates WHERE kind = ?`, ['hperfor-web']);
  }
}
