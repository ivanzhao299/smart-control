import { DataSource } from 'typeorm';
import { AddWelcomeLogo1789720000000 } from '../../migrations/1789720000000-AddWelcomeLogo';

describe('AddWelcomeLogo migration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:' });
    await dataSource.initialize();
    await dataSource.query(`
      CREATE TABLE system_branding_v2 (
        id integer PRIMARY KEY,
        systemName varchar(80) NOT NULL,
        welcomeTitle varchar(32)
      )
    `);
    await dataSource.query(
      `INSERT INTO system_branding_v2 (id, systemName, welcomeTitle) VALUES (1, ?, ?)`,
      ['现场名称', '原欢迎标题'],
    );
  });

  afterEach(async () => dataSource.destroy());

  it('adds one nullable logo column without changing existing welcome data', async () => {
    const migration = new AddWelcomeLogo1789720000000();
    const runner = dataSource.createQueryRunner();
    await migration.up(runner);
    await migration.up(runner);

    const columns = await dataSource.query(`PRAGMA table_info("system_branding_v2")`);
    expect(
      columns.filter((column: { name: string }) => column.name === 'welcomeLogoMediaId'),
    ).toHaveLength(1);
    await expect(
      dataSource.query(
        `SELECT systemName, welcomeTitle, welcomeLogoMediaId FROM system_branding_v2 WHERE id = 1`,
      ),
    ).resolves.toEqual([
      {
        systemName: '现场名称',
        welcomeTitle: '原欢迎标题',
        welcomeLogoMediaId: null,
      },
    ]);
    await runner.release();
  });
});
