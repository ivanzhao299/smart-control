import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the separately routed ePa 4G/MQTT breaker driver.
 *
 * This is intentionally a new catalog migration instead of editing the immutable
 * 178961 snapshot, so every installed site converges through the same history.
 */
export class AddEpaMqttDriverTemplate1789710000000 implements MigrationInterface {
  name = 'AddEpaMqttDriverTemplate1789710000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const capabilities = ['turn_on', 'turn_off', 'get_status', 'get_measurements', 'health_check'];
    const defaultAddressing = { gatewayId: '', clientId: '' };
    const paramSchema = {
      gatewayId: {
        type: 'string',
        label: '4G 网关 ID',
        required: true,
        placeholder: 'GW00000001',
      },
      clientId: {
        type: 'string',
        label: '设备 ClientID / SN',
        required: true,
        placeholder: '设备铭牌或厂家平台中的 ClientID',
      },
    };
    await queryRunner.query(
      `INSERT INTO driver_templates
       (kind, "displayName", vendor, category, protocol, "capabilitiesJson",
        "defaultAddressingJson", "paramSchemaJson", remark, builtin, enabled,
        created_at, updated_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE NOT EXISTS (SELECT 1 FROM driver_templates WHERE kind = ?)`,
      [
        'epa-breaker-mqtt',
        'ePa 4G 智能断路器 (MQTT)',
        'ePa',
        'power-breaker-4g',
        'mqtt-json',
        JSON.stringify(capabilities),
        JSON.stringify(defaultAddressing),
        JSON.stringify(paramSchema),
        '户外路灯、水泵等独立 4G 回路。设备上行 from/epa/{gatewayId}，平台下行 to/epa/{gatewayId}；broker 凭据只保存在服务端环境变量。',
        'epa-breaker-mqtt',
      ],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM hardware_units WHERE "driverKind" = ?`,
      ['epa-breaker-mqtt'],
    )) as Array<{ count: number }>;
    if (Number(count) > 0) {
      throw new Error('EPA_MQTT_DRIVER_ROLLBACK_REQUIRES_HARDWARE_REASSIGNMENT');
    }
    await queryRunner.query(`DELETE FROM driver_templates WHERE kind = ?`, ['epa-breaker-mqtt']);
  }
}
