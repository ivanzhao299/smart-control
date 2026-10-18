import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 电源「分区（楼层）二级管理」(2026-10-18).
 *
 * 纯增量、幂等 (CREATE TABLE/INDEX IF NOT EXISTS + 回填冲突跳过), 双方言
 * (生产 PostgreSQL / 本地 SQLite):
 *  1. 新建 power_floor 分区档案表，复合唯一 (domain_code, code)。
 *  2. 从 power_circuit 现有 (domain_code, floor) 去重回填：
 *     历史分区 code = 现有 floor 中文值（1F/二台时序/时序器…），name 同值，
 *     零改回路数据；sort_order 按域内 floor 排序生成，保证 tab 初始顺序稳定。
 *
 * 之后回路 power_circuit.floor 语义上是分区 code（列名/列结构不变）；
 * 改名只改 power_floor.name，回路无需逐路修改，整层一次性跟随。
 *
 * 幂等：回填靠 (domain_code,code) 唯一索引，PG ON CONFLICT / SQLite INSERT OR IGNORE，
 * 重跑不覆盖用户之后在后台做的改名/排序/停用。
 */
export class CreatePowerFloors1792500000000 implements MigrationInterface {
  name = 'CreatePowerFloors1792500000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";

    // 1. 分区档案表
    await q.query(`CREATE TABLE IF NOT EXISTS "power_floor" (
      "id" ${pg ? 'SERIAL' : 'integer'} PRIMARY KEY,
      "domain_code" varchar(32) NOT NULL,
      "code" varchar(48) NOT NULL,
      "name" varchar(64) NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 100,
      "enabled" boolean NOT NULL DEFAULT 1,
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "idx_power_floor_domain_code" ON "power_floor" ("domain_code","code")`,
    );

    // 2. 回填：从现有回路去重收录（域内按 floor 排序给初始 sort_order）。
    if (pg) {
      await q.query(
        `INSERT INTO "power_floor" ("domain_code","code","name","sort_order","enabled","created_at","updated_at")
         SELECT c.domain_code, c.floor, c.floor,
           (SELECT COUNT(DISTINCT x.floor) FROM power_circuit x
             WHERE x.domain_code = c.domain_code AND x.floor <= c.floor) * 10,
           true, now(), now()
         FROM (SELECT DISTINCT domain_code, floor FROM power_circuit
               WHERE floor IS NOT NULL AND floor <> '') c
         ON CONFLICT ("domain_code","code") DO NOTHING`,
      );
    } else {
      await q.query(
        `INSERT OR IGNORE INTO power_floor (domain_code, code, name, sort_order, enabled, created_at, updated_at)
         SELECT c.domain_code, c.floor, c.floor,
           (SELECT COUNT(DISTINCT x.floor) FROM power_circuit x
             WHERE x.domain_code = c.domain_code AND x.floor <= c.floor) * 10,
           1, datetime('now'), datetime('now')
         FROM (SELECT DISTINCT domain_code, floor FROM power_circuit
               WHERE floor IS NOT NULL AND floor <> '') c`,
      );
    }
  }

  async down(): Promise<void> {
    // 纯增量功能域；保留 power_floor 表与历史数据，不回滚。
  }
}
