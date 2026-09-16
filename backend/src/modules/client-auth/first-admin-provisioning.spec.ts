import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { verifyPassword } from '../../common/utils/password.util';

const Database = require('better-sqlite3');
const { provisionFirstAdmin } = require('../../../scripts/provision-first-admin.cjs') as {
  provisionFirstAdmin(options: { databasePath: string; username: string; password: string }): {
    id: number; username: string; role: string; enabled: number;
  };
};

describe('first administrator provisioning', () => {
  let directory: string;
  let databasePath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'smart-control-admin-'));
    databasePath = join(directory, 'db.sqlite');
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE migrations (id integer PRIMARY KEY, timestamp bigint NOT NULL, name varchar NOT NULL);
      INSERT INTO migrations VALUES (1, 1789650000000, 'EstablishNamedIdentityAuthority1789650000000');
      CREATE TABLE users (
        id integer PRIMARY KEY AUTOINCREMENT, username varchar(64) NOT NULL UNIQUE,
        password varchar(256) NOT NULL, role varchar(16) NOT NULL DEFAULT 'viewer',
        enabled boolean NOT NULL DEFAULT 1, created_at datetime NOT NULL,
        updated_at datetime NOT NULL
      );
    `);
    db.close();
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('atomically creates one named admin without storing plaintext', () => {
    const password = 'Test-only-admin-2026';
    expect(provisionFirstAdmin({ databasePath, username: 'owner', password })).toMatchObject({
      username: 'owner', role: 'admin', enabled: 1,
    });
    const db = new Database(databasePath, { readonly: true });
    const row = db.prepare('SELECT * FROM users').get();
    db.close();
    expect(row.password).not.toContain(password);
    expect(verifyPassword(password, row.password)).toBe(true);
    expect(() => provisionFirstAdmin({ databasePath, username: 'other', password })).toThrow(
      /already exists/,
    );
  });

  it('rejects weak credentials before opening a write transaction', () => {
    expect(() => provisionFirstAdmin({ databasePath, username: 'owner', password: 'short' })).toThrow(
      /12-128/,
    );
    const db = new Database(databasePath, { readonly: true });
    expect(db.prepare('SELECT COUNT(*) AS count FROM users').get().count).toBe(0);
    db.close();
  });
});
