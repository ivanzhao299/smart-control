import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * em123 小时级抄表记录表 em123_hourly (2026-10-15).
 *
 * 用于三相关口总表小时负荷: 存平台每小时定时抄表(readingType=0)的原始字轮读数、
 * 该小时用量(已乘倍率)与小时平均功率, 还原真实负荷曲线/峰值/平均, 零硬件。
 *
 * 纯新增、幂等 (CREATE TABLE / INDEX IF NOT EXISTS), 不触碰既有表与数据。
 * 按数据库方言分别建表: 生产 PostgreSQL (double precision / timestamptz),
 * 本地 SQLite (double / datetime)。(meter_no, reading_time) 为复合业务主键,
 * 定时同步 upsert 幂等 (沿用 em123_daily 业务键主键做法, 避免自增 id 回填失败)。
 */
export class AddEm123Hourly1790501000000 implements MigrationInterface {
  name = 'AddEm123Hourly1790501000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const dbl = pg ? 'double precision' : 'double';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";

    await q.query(`CREATE TABLE IF NOT EXISTS "em123_hourly" (
      "meter_no" varchar(64) NOT NULL,
      "meter_type" varchar(2) NOT NULL,
      "reading_time" varchar(20) NOT NULL,
      "reading_value" ${dbl} NOT NULL DEFAULT 0,
      "hour_use" ${dbl} NOT NULL DEFAULT 0,
      "hour_avg_kw" ${dbl} NOT NULL DEFAULT 0,
      "use_money" ${dbl} NOT NULL DEFAULT 0,
      "csq" varchar(8),
      "reading_type" varchar(2) NOT NULL DEFAULT '0',
      "created_at" ${ts},
      "updated_at" ${ts},
      PRIMARY KEY ("meter_no", "reading_time")
    )`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "ix_em123_hourly_type_time" ON "em123_hourly" ("meter_type", "reading_time")`,
    );
  }

  async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS "ix_em123_hourly_type_time"`);
    await q.query(`DROP TABLE IF EXISTS "em123_hourly"`);
  }
}
