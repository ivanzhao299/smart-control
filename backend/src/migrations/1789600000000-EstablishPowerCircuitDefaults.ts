import { MigrationInterface, QueryRunner } from 'typeorm';

interface PowerCircuitDefault {
  code: string;
  name: string;
  floor: string;
  category: string;
  gatewayCode: string;
  relayChannel: number | null;
  ratedVoltage: number;
  ratedCurrent: number;
  ratedPower: number;
  sortOrder: number;
  icon: string;
  description: string | null;
}

const DEFAULT_CIRCUITS: PowerCircuitDefault[] = [
  {
    code: '1f-main',
    name: '一层总闸',
    floor: '1F',
    category: 'misc',
    gatewayCode: 'RELAY-1F-1',
    relayChannel: 1,
    ratedVoltage: 380,
    ratedCurrent: 63,
    ratedPower: 24000,
    sortOrder: 1,
    icon: 'Zap',
    description: '一层进线总开关 (3 相)',
  },
  {
    code: '1f-lighting',
    name: '一层照明回路',
    floor: '1F',
    category: 'lighting',
    gatewayCode: 'RELAY-1F-1',
    relayChannel: 2,
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 2200,
    sortOrder: 10,
    icon: 'Lightbulb',
    description: null,
  },
  {
    code: '1f-socket',
    name: '一层插座回路',
    floor: '1F',
    category: 'socket',
    gatewayCode: 'RELAY-1F-1',
    relayChannel: 3,
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 1500,
    sortOrder: 20,
    icon: 'Plug',
    description: null,
  },
  {
    code: '1f-led',
    name: '一层 LED 大屏',
    floor: '1F',
    category: 'led',
    gatewayCode: 'BREAKER-LED-1',
    relayChannel: null,
    ratedVoltage: 380,
    ratedCurrent: 40,
    ratedPower: 19000,
    sortOrder: 30,
    icon: 'MonitorPlay',
    description: 'LED 大屏远程总闸 (ePa 智能断路器, 三相 40A)',
  },
  {
    code: '2f-lighting',
    name: '二层照明回路',
    floor: '2F',
    category: 'lighting',
    gatewayCode: 'RELAY-2F-1',
    relayChannel: 1,
    ratedVoltage: 220,
    ratedCurrent: 16,
    ratedPower: 1800,
    sortOrder: 10,
    icon: 'Lightbulb',
    description: null,
  },
  {
    code: '2f-hvac',
    name: '二层空调回路',
    floor: '2F',
    category: 'hvac',
    gatewayCode: 'RELAY-2F-1',
    relayChannel: 2,
    ratedVoltage: 380,
    ratedCurrent: 40,
    ratedPower: 12000,
    sortOrder: 20,
    icon: 'Snowflake',
    description: null,
  },
  ...Array.from({ length: 8 }, (_, index): PowerCircuitDefault => {
    const channel = index + 1;
    return {
      code: `seq-${channel}`,
      name: `时序 ${channel} 路`,
      floor: '音响',
      category: 'audio-seq',
      gatewayCode: 'AUDIO-PWR-SEQ-1',
      relayChannel: channel,
      ratedVoltage: 220,
      ratedCurrent: 16,
      ratedPower: 2000,
      sortOrder: 100 + index,
      icon: 'Plug',
      description: `EPO-802P 时序器通道 ${channel}`,
    };
  }),
];

/** Move fresh-install defaults and narrowly matched historical repairs out of service startup. */
export class EstablishPowerCircuitDefaults1789600000000 implements MigrationInterface {
  name = 'EstablishPowerCircuitDefaults1789600000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      'SELECT COUNT(*) AS count FROM power_circuit',
    )) as Array<{ count: number }>;

    if (Number(count) === 0) {
      for (const circuit of DEFAULT_CIRCUITS) {
        await queryRunner.query(
          `INSERT INTO power_circuit
           (code, name, floor, category, gateway_code, relay_channel, meter_address,
            rated_voltage, rated_current, rated_power, sort_order, icon, description, enabled,
            created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
          [
            circuit.code,
            circuit.name,
            circuit.floor,
            circuit.category,
            circuit.gatewayCode,
            circuit.relayChannel,
            circuit.ratedVoltage,
            circuit.ratedCurrent,
            circuit.ratedPower,
            circuit.sortOrder,
            circuit.icon,
            circuit.description,
          ],
        );
      }
      return;
    }

    await queryRunner.query(
      `UPDATE power_circuit
       SET gateway_code = 'BREAKER-LED-1',
           relay_channel = NULL,
           rated_voltage = CASE WHEN rated_voltage = 220 THEN 380 ELSE rated_voltage END,
           rated_current = CASE WHEN rated_current = 20 THEN 40 ELSE rated_current END,
           rated_power = CASE WHEN rated_power = 3500 THEN 19000 ELSE rated_power END,
           description = COALESCE(description, 'LED 大屏远程总闸 (ePa 智能断路器, 三相 40A)'),
           updated_at = CURRENT_TIMESTAMP
       WHERE code = '1f-led' AND gateway_code = 'RELAY-1F-1' AND relay_channel = 4`,
    );

    const pair = (await queryRunner.query(
      `SELECT code, relay_channel AS relayChannel
       FROM power_circuit WHERE code IN ('seq-4', 'seq-5') ORDER BY code`,
    )) as Array<{ code: string; relayChannel: number | null }>;
    if (
      pair.length === 2 &&
      pair[0]?.code === 'seq-4' &&
      pair[0].relayChannel === 5 &&
      pair[1]?.code === 'seq-5' &&
      pair[1].relayChannel === 4
    ) {
      await queryRunner.query(
        `UPDATE power_circuit
         SET relay_channel = 4, updated_at = CURRENT_TIMESTAMP WHERE code = 'seq-4'`,
      );
      await queryRunner.query(
        `UPDATE power_circuit
         SET relay_channel = 5, updated_at = CURRENT_TIMESTAMP WHERE code = 'seq-5'`,
      );
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      'SELECT COUNT(*) AS count FROM power_circuit',
    )) as Array<{ count: number }>;
    if (Number(count) > 0) {
      throw new Error(
        'POWER_CIRCUIT_ROLLBACK_REQUIRES_ARCHIVE: authoritative configuration exists',
      );
    }
  }
}
