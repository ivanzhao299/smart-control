import { DataSource } from 'typeorm';
import { EstablishNamedIdentityAuthority1789650000000 } from '../../migrations/1789650000000-EstablishNamedIdentityAuthority';

describe('EstablishNamedIdentityAuthority migration', () => {
  let dataSource: DataSource;

  beforeEach(async () => {
    dataSource = await new DataSource({ type: 'better-sqlite3', database: ':memory:' }).initialize();
    for (const table of ['client_auth_v1', 'admin_auth_v1']) {
      await dataSource.query(`CREATE TABLE ${table} (
        id integer PRIMARY KEY, passwordHash varchar(255) NOT NULL,
        passwordChangedAt datetime NOT NULL, tokenSecret varchar(64), updatedAt datetime NOT NULL
      )`);
    }
  });

  afterEach(async () => dataSource.destroy());

  it('preserves every existing credential and secret byte-for-byte', async () => {
    for (const table of ['client_auth_v1', 'admin_auth_v1']) {
      await dataSource.query(
        `INSERT INTO ${table} VALUES (1, ?, ?, ?, ?)`,
        [`existing-${table}`, '2026-01-02 03:04:05', table[0].repeat(64), '2026-01-02 03:04:06'],
      );
    }
    const before = await Promise.all(['client_auth_v1', 'admin_auth_v1'].map(table => dataSource.query(`SELECT * FROM ${table}`)));
    await new EstablishNamedIdentityAuthority1789650000000().up(dataSource.createQueryRunner());
    const after = await Promise.all(['client_auth_v1', 'admin_auth_v1'].map(table => dataSource.query(`SELECT * FROM ${table}`)));
    expect(after).toEqual(before);
  });

  it('creates locked compatibility rows only when missing', async () => {
    await new EstablishNamedIdentityAuthority1789650000000().up(dataSource.createQueryRunner());
    for (const table of ['client_auth_v1', 'admin_auth_v1']) {
      const rows = await dataSource.query(`SELECT * FROM ${table}`);
      expect(rows).toHaveLength(1);
      expect(rows[0].passwordHash).toBe('retired$named-account-required');
      expect(rows[0].tokenSecret).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});
