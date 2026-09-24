import { DataSource } from 'typeorm';
import { AddWelcomeVenueOrgs1789740000000 } from '../../migrations/1789740000000-AddWelcomeVenueOrgs';

describe('AddWelcomeVenueOrgs migration', () => {
  const NEW_COLUMNS = ['welcomeVenue', 'welcomeVenueEn', 'welcomeOrg1', 'welcomeOrg2'];

  it('is additive, idempotent, nullable and preserves existing rows', async () => {
    const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
    try {
      await dataSource.query(`
        CREATE TABLE system_branding_v2 (
          id integer PRIMARY KEY,
          welcomeTitle varchar(32)
        )
      `);
      await dataSource.query(
        `INSERT INTO system_branding_v2 (id, welcomeTitle) VALUES (1, ?)`,
        ['原欢迎标题'],
      );
      const runner = dataSource.createQueryRunner();
      const migration = new AddWelcomeVenueOrgs1789740000000();
      await migration.up(runner);
      await migration.up(runner); // idempotent

      const columns = await dataSource.query(`PRAGMA table_info("system_branding_v2")`);
      for (const name of NEW_COLUMNS) {
        const match = columns.filter((c: { name: string }) => c.name === name);
        expect(match).toHaveLength(1);
        // nullable: existing rows must read back NULL without a default
        expect(match[0].notnull).toBe(0);
      }

      const rows = await dataSource.query(
        `SELECT welcomeTitle, ${NEW_COLUMNS.join(', ')} FROM system_branding_v2 WHERE id = 1`,
      );
      expect(rows).toEqual([{
        welcomeTitle: '原欢迎标题',
        welcomeVenue: null,
        welcomeVenueEn: null,
        welcomeOrg1: null,
        welcomeOrg2: null,
      }]);

      await migration.down(runner);
      const after = await dataSource.query(`PRAGMA table_info("system_branding_v2")`);
      expect(after.some((c: { name: string }) => NEW_COLUMNS.includes(c.name))).toBe(false);
      await runner.release();
    } finally {
      await dataSource.destroy();
    }
  });
});
