import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * em123 智慧能源平台接入: 电/水表档案表 em123_meter 与按日用量表 em123_daily (2026-10-14).
 *
 * 纯新增、幂等 (CREATE TABLE / INDEX IF NOT EXISTS), 不触碰既有表与数据。
 * 按数据库方言分别建表: 生产 PostgreSQL (double precision / timestamptz),
 * 本地 SQLite (double / datetime)。表档案以 meter_no 为业务主键, 日用量以
 * (meter_no,date) 为复合主键, 定时同步 upsert 幂等 (避免自增 id + 非主键冲突列
 * 在 SQLite 下 upsert 回填实体失败)。
 */
export class AddEm123Meters1790500000000 implements MigrationInterface {
  name = 'AddEm123Meters1790500000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const dbl = pg ? 'double precision' : 'double';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";

    await q.query(`CREATE TABLE IF NOT EXISTS "em123_meter" (
      "meter_no" varchar(64) PRIMARY KEY,
      "meter_type" varchar(2) NOT NULL,
      "meter_name" varchar(128) NOT NULL,
      "house_id" varchar(32),
      "zone" varchar(8),
      "area_group" varchar(32),
      "building" varchar(32),
      "building_name" varchar(64),
      "room" varchar(16),
      "kind" varchar(12) NOT NULL DEFAULT 'household',
      "meter_model" varchar(32),
      "model_name" varchar(64),
      "device_imei" varchar(32),
      "conn_type" varchar(16),
      "multiply" ${dbl} NOT NULL DEFAULT 1,
      "price_name" varchar(64),
      "reading_value" ${dbl} NOT NULL DEFAULT 0,
      "reading_kwh" ${dbl} NOT NULL DEFAULT 0,
      "reading_time" varchar(32),
      "charge_money" ${dbl} NOT NULL DEFAULT 0,
      "online_status" varchar(12) NOT NULL DEFAULT 'offline',
      "meter_status" varchar(4),
      "alarm_name" varchar(128),
      "sort_order" integer NOT NULL DEFAULT 0,
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_em123_meter_type_kind" ON "em123_meter" ("meter_type", "kind")`,
    );

    await q.query(`CREATE TABLE IF NOT EXISTS "em123_daily" (
      "meter_no" varchar(64) NOT NULL,
      "meter_type" varchar(2) NOT NULL,
      "date" varchar(10) NOT NULL,
      "use_limit" ${dbl} NOT NULL DEFAULT 0,
      "use_money" ${dbl} NOT NULL DEFAULT 0,
      "start_value" ${dbl},
      "end_value" ${dbl},
      "created_at" ${ts},
      "updated_at" ${ts},
      PRIMARY KEY ("meter_no", "date")
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_em123_daily_type_date" ON "em123_daily" ("meter_type", "date")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_em123_daily_type_date"`);
    await q.query(`DROP TABLE IF EXISTS "em123_daily"`);
    await q.query(`DROP INDEX IF EXISTS "ix_em123_meter_type_kind"`);
    await q.query(`DROP TABLE IF EXISTS "em123_meter"`);
  }
}
