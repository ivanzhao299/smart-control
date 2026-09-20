import { DataSource } from 'typeorm';
import { AddWelcomePresentation1789730000000 } from '../../migrations/1789730000000-AddWelcomePresentation';

describe('AddWelcomePresentation migration', () => {
  it('is idempotent and preserves the published welcome snapshot', async () => {
    const dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
    try {
      await dataSource.query(`
        CREATE TABLE system_branding_v2 (
          id integer PRIMARY KEY,
          welcomeTitle varchar(32),
          welcomeLogoMediaId integer
        )
      `);
      await dataSource.query(
        `INSERT INTO system_branding_v2 (id, welcomeTitle, welcomeLogoMediaId) VALUES (1, ?, ?)`,
        ['原欢迎标题', 18],
      );
      const runner = dataSource.createQueryRunner();
      const migration = new AddWelcomePresentation1789730000000();
      await migration.up(runner);
      await migration.up(runner);

      const columns = await dataSource.query(`PRAGMA table_info("system_branding_v2")`);
      expect(
        columns.filter((column: { name: string }) => column.name === 'welcomePresentationJson'),
      ).toHaveLength(1);
      await expect(dataSource.query(
        `SELECT welcomeTitle, welcomeLogoMediaId, welcomePresentationJson
         FROM system_branding_v2 WHERE id = 1`,
      )).resolves.toEqual([{
        welcomeTitle: '原欢迎标题',
        welcomeLogoMediaId: 18,
        welcomePresentationJson: null,
      }]);
      await runner.release();
    } finally {
      await dataSource.destroy();
    }
  });
});
