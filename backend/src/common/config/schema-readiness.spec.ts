import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertSchemaReady,
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_MIGRATIONS,
} from './schema-readiness';

type Row = Record<string, string | number>;

const readyDatabase = (options: { missingMigration?: string; missingColumn?: string } = {}) => ({
  prepare: (sql: string) => ({
    all: (): Row[] => {
      if (sql === 'SELECT name FROM migrations') {
        return REQUIRED_SCHEMA_MIGRATIONS.filter((name) => name !== options.missingMigration).map(
          (name) => ({ name }),
        );
      }
      const table = sql.match(/^PRAGMA table_info\("([^"]+)"\)$/)?.[1];
      if (table) {
        return (REQUIRED_SCHEMA_COLUMNS[table] ?? [])
          .filter((name) => name !== options.missingColumn)
          .map((name) => ({ name, notnull: 0 }));
      }
      if (sql.includes("type = 'trigger'")) {
        return [
          { name: 'protect_last_administrator_delete' },
          { name: 'protect_last_administrator_demotion' },
        ];
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  }),
});

describe('database schema readiness', () => {
  it('accepts a fully migrated schema without writing to it', () => {
    expect(() => assertSchemaReady(readyDatabase())).not.toThrow();
  });

  it('rejects a missing migration or column before services start', () => {
    expect(() =>
      assertSchemaReady(readyDatabase({ missingMigration: 'AddWelcomePhoto1789300000000' })),
    ).toThrow(/run migration:run/);
    expect(() => assertSchemaReady(readyDatabase({ missingColumn: 'tokenSecret' }))).toThrow(
      /run migration:run/,
    );
  });

  it('keeps schema DDL out of service startup hooks', () => {
    const root = resolve(__dirname, '../../../..');
    for (const file of [
      'backend/src/modules/admin-auth/admin-auth.service.ts',
      'backend/src/modules/client-auth/client-auth.service.ts',
      'backend/src/modules/baidu-pan/baidu-pan.service.ts',
      'backend/src/modules/playback/playback.service.ts',
      'backend/src/modules/system-branding/system-branding.service.ts',
    ]) {
      const source = readFileSync(resolve(root, file), 'utf8');
      expect(source).not.toMatch(/\b(?:ALTER|CREATE|DROP)\s+TABLE\b/i);
    }
  });
});
