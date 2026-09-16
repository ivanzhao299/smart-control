import { createHash } from 'crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const Database = require('better-sqlite3');
const { reconcile } = require('../../../scripts/reconcile-app-release.cjs') as {
  reconcile: (options: {
    manifestPath: string;
    artifactPath: string;
    databasePath: string;
    checkOnly?: boolean;
  }) => { state: string; versionCode: number; versionName: string };
};

describe('Android app release deployment reconciler', () => {
  let directory: string;
  let databasePath: string;
  let artifactPath: string;
  let manifestPath: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'app-release-reconciler-'));
    databasePath = join(directory, 'release.sqlite');
    artifactPath = join(directory, 'smart-control-latest.apk');
    manifestPath = join(directory, 'manifest.json');
    writeFileSync(artifactPath, Buffer.from('verified Android package'));
    const artifact = Buffer.from('verified Android package');
    writeFileSync(
      manifestPath,
      JSON.stringify({
        schemaVersion: 1,
        platform: 'android',
        versionCode: 22,
        versionName: '1.1.14',
        commit: 'a'.repeat(40),
        builtAt: '2026-09-16T05:00:03Z',
        apkSha256: createHash('sha256').update(artifact).digest('hex'),
        apkSize: artifact.length,
      }),
    );
    const db = new Database(databasePath);
    db.exec(`
      CREATE TABLE app_release_v1 (
        id integer PRIMARY KEY AUTOINCREMENT,
        platform varchar(16) NOT NULL UNIQUE,
        versionCode integer NOT NULL,
        versionName varchar(32) NOT NULL,
        download_url varchar(512) NOT NULL,
        notes text,
        force_update boolean NOT NULL DEFAULT 0,
        min_supported_version_code integer NOT NULL DEFAULT 1,
        enabled boolean NOT NULL DEFAULT 1,
        release_source varchar(16) NOT NULL DEFAULT 'manual',
        artifact_commit varchar(40),
        artifact_sha256 varchar(64),
        artifact_size integer,
        artifact_built_at datetime,
        created_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at datetime NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
    `);
    db.prepare(
      `INSERT INTO app_release_v1
       (platform, versionCode, versionName, download_url, notes, force_update,
        min_supported_version_code, enabled, release_source)
       VALUES ('android', 21, '1.1.13', 'https://old.example/app.apk', '现场说明', 1, 8, 0,
               'bundled')`,
    ).run();
    db.close();
  });

  afterEach(() => rmSync(directory, { recursive: true, force: true }));

  it('atomically advances artifact metadata and preserves operator policy', () => {
    expect(reconcile({ manifestPath, artifactPath, databasePath })).toEqual({
      state: 'updated',
      versionCode: 22,
      versionName: '1.1.14',
    });

    const db = new Database(databasePath, { readonly: true });
    const row = db.prepare('SELECT * FROM app_release_v1 WHERE platform = ?').get('android');
    db.close();
    expect(row).toMatchObject({
      versionCode: 22,
      versionName: '1.1.14',
      download_url: 'http://192.168.77.54:3200/api/app/android/download',
      notes: '现场说明',
      force_update: 1,
      min_supported_version_code: 8,
      enabled: 0,
      release_source: 'bundled',
      artifact_commit: 'a'.repeat(40),
      artifact_sha256: JSON.parse(require('fs').readFileSync(manifestPath, 'utf8')).apkSha256,
      artifact_size: Buffer.from('verified Android package').length,
      artifact_built_at: '2026-09-16T05:00:03.000Z',
    });
    expect(reconcile({ manifestPath, artifactPath, databasePath, checkOnly: true }).state).toBe(
      'current',
    );
  });

  it('rejects a damaged artifact without changing the authoritative row', () => {
    writeFileSync(artifactPath, Buffer.from('damaged Android package'));
    expect(() => reconcile({ manifestPath, artifactPath, databasePath })).toThrow(
      /artifact (size|checksum) mismatch/,
    );

    const db = new Database(databasePath, { readonly: true });
    const row = db.prepare('SELECT versionCode, notes FROM app_release_v1').get();
    db.close();
    expect(row).toEqual({ versionCode: 21, notes: '现场说明' });
  });

  it('refuses to publish an artifact older than the database release', () => {
    const db = new Database(databasePath);
    db.prepare('UPDATE app_release_v1 SET versionCode = 23, versionName = ?').run('1.1.15');
    db.close();

    expect(() => reconcile({ manifestPath, artifactPath, databasePath })).toThrow(
      'Bundled Android artifact is older than the authoritative release',
    );
  });
});
