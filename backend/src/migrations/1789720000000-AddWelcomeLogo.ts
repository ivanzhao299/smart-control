import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Additive only: stores the currently published welcome-page logo media id. */
export class AddWelcomeLogo1789720000000 implements MigrationInterface {
  name = 'AddWelcomeLogo1789720000000';

  async up(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists =
      Array.isArray(columns) &&
      columns.some((column: { name?: string }) => column?.name === 'welcomeLogoMediaId');
    if (!exists) {
      await q.addColumn(
        'system_branding_v2',
        new TableColumn({ name: 'welcomeLogoMediaId', type: 'integer', isNullable: true }),
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists =
      Array.isArray(columns) &&
      columns.some((column: { name?: string }) => column?.name === 'welcomeLogoMediaId');
    if (exists) await q.dropColumn('system_branding_v2', 'welcomeLogoMediaId');
  }
}
