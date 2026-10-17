import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 电源开关「域」划分 (2026-10-17, 第五轮).
 *
 * 纯增量、幂等 (CREATE TABLE/INDEX IF NOT EXISTS), 双方言 (生产 PostgreSQL / 本地 SQLite):
 *  1. 新建 power_domain 域档案表, 并种子两条:
 *       hall 展厅 (楼内 1F/2F/音响时序器, 展厅操作员操作域)
 *       park 园区 (户外 4G 断路器: 庭院/鱼池/路灯/楼顶字, 运营配置员操作域)
 *  2. power_circuit 新增 domain_code (默认 'hall'), 与 floor(域内楼层/位置) 解耦.
 *  3. 按 floor 归位现有回路: floor='园区' → park; 其余 (1F/2F/音响) 保持默认 hall.
 *
 * 扩展性: 新增楼栋/区域 = 在后台「电源域」插一条域, 再给回路选所属域, 无需改库表.
 * 幂等: 重跑只把仍是默认 'hall' 的园区回路修正为 park, 不覆盖用户之后手动改的域.
 */
export class CreatePowerDomains1792300000000 implements MigrationInterface {
  name = 'CreatePowerDomains1792300000000';

  async up(q: QueryRunner): Promise<void> {
    const pg = q.connection.options.type === 'postgres';
    const ts = pg ? 'timestamptz NOT NULL DEFAULT now()' : "datetime NOT NULL DEFAULT (datetime('now'))";

    // 1. 域档案表
    await q.query(`CREATE TABLE IF NOT EXISTS "power_domain" (
      "id" ${pg ? 'SERIAL' : 'integer'} PRIMARY KEY,
      "code" varchar(32) NOT NULL,
      "name" varchar(64) NOT NULL,
      "sort_order" integer NOT NULL DEFAULT 100,
      "description" varchar(255),
      "enabled" boolean NOT NULL DEFAULT 1,
      "created_at" ${ts},
      "updated_at" ${ts}
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "idx_power_domain_code" ON "power_domain" ("code")`);

    // 2. 种子域（幂等: 靠 code 唯一索引, PG ON CONFLICT / SQLite INSERT OR IGNORE）
    const rows: Array<[string, string, number, string]> = [
      ['hall', '展厅', 10, '楼内展厅与播控：1F/2F/音响时序器（LED大屏/功放/投影/融合器等），展厅操作员操作域'],
      ['park', '园区', 20, '园区户外 4G 远程断路器：庭院亮化/鱼池供氧/路灯/楼顶大字，运营配置员操作域'],
    ];
    for (const [code, name, sortOrder, description] of rows) {
      if (pg) {
        await q.query(
          `INSERT INTO "power_domain" ("code","name","sort_order","description","enabled")
           VALUES ('${code}','${name}',${sortOrder},'${description}',true)
           ON CONFLICT ("code") DO NOTHING`,
        );
      } else {
        await q.query(
          `INSERT OR IGNORE INTO "power_domain" ("code","name","sort_order","description","enabled")
           VALUES ('${code}','${name}',${sortOrder},'${description}',1)`,
        );
      }
    }

    // 3. power_circuit 加 domain_code 列（双方言幂等）
    if (pg) {
      const exists = await q.query(
        `SELECT column_name FROM information_schema.columns
         WHERE table_name='power_circuit' AND column_name='domain_code'`,
      );
      if (Array.isArray(exists) && exists.length === 0) {
        await q.query(`ALTER TABLE "power_circuit" ADD COLUMN "domain_code" varchar(32) NOT NULL DEFAULT 'hall'`);
      }
    } else {
      const cols = (await q.query(`PRAGMA table_info(power_circuit)`)) as Array<{ name: string }>;
      if (cols.length > 0 && !cols.some((c) => c.name === 'domain_code')) {
        await q.query(`ALTER TABLE power_circuit ADD COLUMN domain_code VARCHAR(32) NOT NULL DEFAULT 'hall'`);
      }
    }

    // 4. 归位：园区回路 → park；只修正仍是默认 hall 的，避免覆盖人工调整。
    await q.query(`UPDATE power_circuit SET domain_code='park' WHERE floor='园区' AND domain_code='hall'`);
    // 楼内展厅（1F/2F/音响）显式归 hall（兜底未知默认值）
    await q.query(
      `UPDATE power_circuit SET domain_code='hall' WHERE floor IN ('1F','2F','音响') AND domain_code<>'hall'`,
    );
  }

  async down(): Promise<void> {
    // 纯增量功能域；保留 power_circuit.domain_code 历史数据, 不回滚表/列。
  }
}
