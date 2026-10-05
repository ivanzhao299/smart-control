import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 能源管理：回路按日用电量表 energy_daily (2026-10-05).
 *
 * 纯新增、幂等 (CREATE TABLE / INDEX IF NOT EXISTS)，不触碰既有表与数据。
 * 按数据库方言分别建表：生产 PostgreSQL (SERIAL / double precision / timestamptz)，
 * 本地 SQLite (integer AUTOINCREMENT / datetime)。
 */
export class AddEnergyDaily1790200000000 implements MigrationInterface {
  name = 'AddEnergyDaily1790200000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    if (pg) {
      await q.query(`CREATE TABLE IF NOT EXISTS "energy_daily" (
        "id" SERIAL PRIMARY KEY,
        "circuit_code" varchar(64) NOT NULL,
        "circuit_id" integer,
        "date" varchar(10) NOT NULL,
        "kwh" double precision NOT NULL DEFAULT 0,
        "source" varchar(16) NOT NULL DEFAULT 'integral',
        "peak_power" double precision,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now()
      )`);
    } else {
      await q.query(`CREATE TABLE IF NOT EXISTS "energy_daily" (
        "id" integer PRIMARY KEY AUTOINCREMENT,
        "circuit_code" varchar(64) NOT NULL,
        "circuit_id" integer,
        "date" varchar(10) NOT NULL,
        "kwh" double precision NOT NULL DEFAULT 0,
        "source" varchar(16) NOT NULL DEFAULT 'integral',
        "peak_power" double precision,
        "created_at" datetime NOT NULL DEFAULT (datetime('now')),
        "updated_at" datetime NOT NULL DEFAULT (datetime('now'))
      )`);
    }
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_energy_daily_circuit_date" ` +
        `ON "energy_daily" ("circuit_code", "date")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "uq_energy_daily_circuit_date"`);
    await q.query(`DROP TABLE IF EXISTS "energy_daily"`);
  }
}
