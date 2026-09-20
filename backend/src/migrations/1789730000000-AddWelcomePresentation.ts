import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/** Additive only: stores the deterministic style snapshot used by the live welcome page. */
export class AddWelcomePresentation1789730000000 implements MigrationInterface {
  name = 'AddWelcomePresentation1789730000000';

  async up(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists =
      Array.isArray(columns) &&
      columns.some((column: { name?: string }) => column?.name === 'welcomePresentationJson');
    if (!exists) {
      await q.addColumn(
        'system_branding_v2',
        new TableColumn({ name: 'welcomePresentationJson', type: 'text', isNullable: true }),
      );
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    const exists =
      Array.isArray(columns) &&
      columns.some((column: { name?: string }) => column?.name === 'welcomePresentationJson');
    if (exists) await q.dropColumn('system_branding_v2', 'welcomePresentationJson');
  }
}
