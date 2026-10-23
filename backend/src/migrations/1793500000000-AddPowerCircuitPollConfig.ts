import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 2026-10-23：电源回路轮询配置列。
 *
 * - poll_enabled: 后台是否轮询此回路 (1=轮, 0=不轮)
 * - poll_when_off: 已知关闭时是否也轮询 (0=仅开时轮, 1=关也轮)
 *
 * 默认值: 所有回路 poll_enabled=1, poll_when_off=0。
 * MQTT/推送型设备由订阅更新，不需要后台轮询，设 poll_enabled=0。
 *
 * 这样不再在代码里 instanceof 写死哪些设备轮询，改 DB 配置即可。
 */
export class AddPowerCircuitPollConfig1793500000000 implements MigrationInterface {
  name = 'AddPowerCircuitPollConfig1793500000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    // SQLite ALTER TABLE ADD COLUMN supports DEFAULT; Postgres too.
    await q.query(
      `ALTER TABLE "power_circuit" ADD COLUMN "poll_enabled" ${pg ? 'boolean' : 'INTEGER'} DEFAULT ${pg ? 'true' : '1'}`,
    );
    await q.query(
      `ALTER TABLE "power_circuit" ADD COLUMN "poll_when_off" ${pg ? 'boolean' : 'INTEGER'} DEFAULT ${pg ? 'false' : '0'}`,
    );

    // MQTT 推送型断路器不需要后台轮询（由订阅消息更新状态）
    // 找 gateway_code 指向 power-breaker-4g (EpaMqttBreakerAdapter) 的回路，关掉轮询
    // 安全: hardware_units 表可能在某些测试隔离库中不存在, 用 try-catch 忽略
    try {
      await q.query(`
        UPDATE "power_circuit"
        SET "poll_enabled" = ${pg ? 'false' : '0'}
        WHERE "gateway_code" IN (
          SELECT "code" FROM "hardware_units" WHERE "category" = 'power-breaker-4g'
        )
      `);
    } catch {
      // hardware_units 表不存在时跳过 (测试隔离库场景)
    }
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE "power_circuit" DROP COLUMN "poll_when_off"`);
    await q.query(`ALTER TABLE "power_circuit" DROP COLUMN "poll_enabled"`);
  }
}
