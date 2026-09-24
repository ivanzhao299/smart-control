import { MigrationInterface, QueryRunner } from 'typeorm';

/** Product-default vendors referenced by the current hardware and driver catalog. */
const DEFAULT_BRAND_NAMES = [
  'JBT',
  'LTECH 雷特',
  'MEANWELL 明纬',
  'ePa',
  '中弘 ZHONGHONG',
  '元创智控',
  '占美 GIADA',
  '奥克斯',
  '得胜 TAKSTAR',
  '有人 USR',
  '诺瓦 NovaStar',
  '通用',
];

/** Move initial and historical brand reconciliation out of application startup. */
export class EstablishBrandCatalog1789620000000 implements MigrationInterface {
  name = 'EstablishBrandCatalog1789620000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const name of DEFAULT_BRAND_NAMES) {
      await this.insertMissing(queryRunner, name);
    }

    const referenced = (await queryRunner.query(
      `SELECT vendor FROM hardware_units WHERE TRIM(COALESCE(vendor, '')) <> ''
       UNION
       SELECT vendor FROM driver_templates WHERE TRIM(COALESCE(vendor, '')) <> ''
       ORDER BY vendor`,
    )) as Array<{ vendor: string }>;
    for (const { vendor } of referenced) {
      await this.insertMissing(queryRunner, vendor);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const [{ count }] = (await queryRunner.query('SELECT COUNT(*) AS count FROM brands')) as Array<{
      count: number;
    }>;
    if (Number(count) > 0) {
      throw new Error('BRAND_CATALOG_ROLLBACK_REQUIRES_ARCHIVE: authoritative catalog exists');
    }
  }

  private async insertMissing(queryRunner: QueryRunner, name: string): Promise<void> {
    await queryRunner.query(
      `INSERT INTO brands (name, enabled, created_at, updated_at)
       SELECT ?, 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
       WHERE NOT EXISTS (SELECT 1 FROM brands WHERE name = ?)`,
      [name, name],
    );
  }
}
