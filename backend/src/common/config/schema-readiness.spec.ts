import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import {
  assertSchemaReady,
  REQUIRED_SCHEMA_COLUMNS,
  REQUIRED_SCHEMA_MIGRATIONS,
} from './schema-readiness';

type Row = Record<string, string | number>;

const videoDocument = JSON.stringify({ version: 1, nvrs: [], channels: [] });
const videoChecksum = createHash('sha256')
  .update(videoDocument, 'utf8')
  .digest('hex');

const readyDatabase = (
  options: {
    missingMigration?: string;
    missingColumn?: string;
    missingBranding?: boolean;
    damagedVideoAuthority?: boolean;
  } = {},
) => ({
  prepare: (sql: string) => ({
    all: (...args: unknown[]): Row[] => {
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
      if (/^SELECT id, tokenSecret FROM "(?:client_auth_v1|admin_auth_v1)"$/.test(sql)) {
        return [{ id: 1, tokenSecret: 'a'.repeat(64) }];
      }
      if (sql === "SELECT id FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1") {
        return [{ id: 1 }];
      }
      if (sql === 'SELECT id FROM system_branding_v2') {
        return options.missingBranding ? [] : [{ id: 1 }];
      }
      if (sql.includes('FROM runtime_config_documents WHERE config_key = ?')) {
        expect(args).toEqual(['video.binding']);
        return [
          {
            schema_version: 1,
            revision: 3,
            document: videoDocument,
            document_sha256: options.damagedVideoAuthority ? '0'.repeat(64) : videoChecksum,
          },
        ];
      }
      if (sql.includes('FROM runtime_config_revisions')) {
        expect(args).toEqual(['video.binding', 3]);
        return [{ document_sha256: videoChecksum }];
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

  it('rejects missing singleton and damaged authority records instead of recreating them', () => {
    expect(() => assertSchemaReady(readyDatabase({ missingBranding: true }))).toThrow(
      /restore required authority records/,
    );
    expect(() => assertSchemaReady(readyDatabase({ damagedVideoAuthority: true }))).toThrow(
      /restore required authority records/,
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
