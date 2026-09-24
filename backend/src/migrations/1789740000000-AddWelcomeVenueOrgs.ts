import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

/**
 * Additive only: editable venue name (CN/EN) and two organizer bylines for the LED welcome page.
 * Three-state text: NULL = built-in default, empty string '' = hide that line, non-empty = custom.
 */
export class AddWelcomeVenueOrgs1789740000000 implements MigrationInterface {
  name = 'AddWelcomeVenueOrgs1789740000000';

  private static readonly COLUMNS: ReadonlyArray<{ name: string; length: number }> = [
    { name: 'welcomeVenue', length: 40 },
    { name: 'welcomeVenueEn', length: 96 },
    { name: 'welcomeOrg1', length: 40 },
    { name: 'welcomeOrg2', length: 40 },
  ];

  async up(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    for (const spec of AddWelcomeVenueOrgs1789740000000.COLUMNS) {
      const exists =
        Array.isArray(columns) &&
        columns.some((column: { name?: string }) => column?.name === spec.name);
      if (!exists) {
        await q.addColumn(
          'system_branding_v2',
          new TableColumn({
            name: spec.name,
            type: 'varchar',
            length: String(spec.length),
            isNullable: true,
          }),
        );
      }
    }
  }

  async down(q: QueryRunner): Promise<void> {
    const columns = await q.query(`PRAGMA table_info("system_branding_v2")`);
    for (const spec of AddWelcomeVenueOrgs1789740000000.COLUMNS) {
      const exists =
        Array.isArray(columns) &&
        columns.some((column: { name?: string }) => column?.name === spec.name);
      if (exists) await q.dropColumn('system_branding_v2', spec.name);
    }
  }
}
