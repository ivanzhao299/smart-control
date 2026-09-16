#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { loadEnvFile } = require('./run-migrations.js');
const { resolveProductionDatabasePath } = require('./production-paths.cjs');

const DOWNLOAD_URL = 'http://192.168.77.54:3200/api/app/android/download';
const REQUIRED_COLUMNS = [
  'release_source',
  'artifact_commit',
  'artifact_sha256',
  'artifact_size',
  'artifact_built_at',
];

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function readManifest(manifestPath, artifactPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (manifest.schemaVersion !== 1) throw new Error('Unsupported app release manifest schema');
  if (manifest.platform !== 'android')
    throw new Error('App release manifest platform must be android');
  if (!Number.isSafeInteger(manifest.versionCode) || manifest.versionCode < 1) {
    throw new Error('App release manifest versionCode must be a positive integer');
  }
  if (
    typeof manifest.versionName !== 'string' ||
    !/^[0-9A-Za-z._-]{1,32}$/.test(manifest.versionName)
  ) {
    throw new Error('App release manifest versionName is invalid');
  }
  if (typeof manifest.commit !== 'string' || !/^[0-9a-f]{40}$/.test(manifest.commit)) {
    throw new Error('App release manifest commit is invalid');
  }
  if (typeof manifest.builtAt !== 'string' || !Number.isFinite(Date.parse(manifest.builtAt))) {
    throw new Error('App release manifest builtAt is invalid');
  }
  if (typeof manifest.apkSha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(manifest.apkSha256)) {
    throw new Error('App release manifest apkSha256 is invalid');
  }
  if (!Number.isSafeInteger(manifest.apkSize) || manifest.apkSize < 1) {
    throw new Error('App release manifest apkSize must be a positive integer');
  }

  const stat = fs.statSync(artifactPath);
  if (!stat.isFile()) throw new Error('Bundled Android artifact is not a file');
  if (stat.size !== manifest.apkSize) throw new Error('Bundled Android artifact size mismatch');
  const actualSha256 = sha256(artifactPath);
  if (actualSha256 !== manifest.apkSha256.toLowerCase()) {
    throw new Error('Bundled Android artifact checksum mismatch');
  }
  return { ...manifest, apkSha256: actualSha256 };
}

function reconcile(options) {
  const manifest = readManifest(options.manifestPath, options.artifactPath);
  const db = new Database(options.databasePath, {
    readonly: Boolean(options.checkOnly),
    fileMustExist: true,
  });
  try {
    if (options.checkOnly) db.pragma('query_only = ON');
    const columns = new Set(
      db
        .prepare('PRAGMA table_info(app_release_v1)')
        .all()
        .map((row) => row.name),
    );
    for (const column of REQUIRED_COLUMNS) {
      if (!columns.has(column))
        throw new Error(`App release migration is missing column ${column}`);
    }

    const inspectOrUpdate = () => {
      const row = db.prepare('SELECT * FROM app_release_v1 WHERE platform = ?').get('android');
      if (!row) throw new Error('Android app release row is missing; run migrations first');
      if (row.release_source !== 'bundled') {
        throw new Error('Android app release row is not deployment-owned');
      }
      if (row.versionCode > manifest.versionCode) {
        throw new Error('Bundled Android artifact is older than the authoritative release');
      }
      if (row.versionCode === manifest.versionCode && row.versionName !== manifest.versionName) {
        throw new Error(
          'Bundled Android artifact versionName conflicts with the authoritative release',
        );
      }

      const exact =
        row.versionCode === manifest.versionCode &&
        row.versionName === manifest.versionName &&
        row.download_url === DOWNLOAD_URL &&
        row.artifact_commit === manifest.commit &&
        String(row.artifact_sha256 || '').toLowerCase() === manifest.apkSha256 &&
        row.artifact_size === manifest.apkSize &&
        new Date(row.artifact_built_at || 0).toISOString() ===
          new Date(manifest.builtAt).toISOString();
      if (exact)
        return { state: 'current', versionCode: row.versionCode, versionName: row.versionName };
      if (options.checkOnly) {
        return {
          state: 'pending',
          versionCode: manifest.versionCode,
          versionName: manifest.versionName,
        };
      }

      db.prepare(
        `UPDATE app_release_v1
         SET versionCode = ?, versionName = ?, download_url = ?,
             artifact_commit = ?, artifact_sha256 = ?, artifact_size = ?,
             artifact_built_at = ?, updated_at = CURRENT_TIMESTAMP
         WHERE platform = 'android' AND release_source = 'bundled'`,
      ).run(
        manifest.versionCode,
        manifest.versionName,
        DOWNLOAD_URL,
        manifest.commit,
        manifest.apkSha256,
        manifest.apkSize,
        new Date(manifest.builtAt).toISOString(),
      );
      return {
        state: 'updated',
        versionCode: manifest.versionCode,
        versionName: manifest.versionName,
      };
    };
    if (options.checkOnly) return inspectOrUpdate();
    return db.transaction(inspectOrUpdate).immediate();
  } finally {
    db.close();
  }
}

function parseArgs(argv) {
  const args = { checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check-only') args.checkOnly = true;
    else if (token === '--manifest') args.manifestPath = argv[++index];
    else if (token === '--artifact') args.artifactPath = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.manifestPath || !args.artifactPath) {
    throw new Error('Required: --manifest <path> --artifact <path>');
  }
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadEnvFile(process.cwd());
  const result = reconcile({
    ...args,
    manifestPath: path.resolve(args.manifestPath),
    artifactPath: path.resolve(args.artifactPath),
    databasePath: resolveProductionDatabasePath({ cwd: process.cwd() }),
  });
  if (args.checkOnly && result.state !== 'current') {
    throw new Error('App release reconciliation is pending');
  }
  process.stdout.write(
    `APP_RELEASE_${result.state.toUpperCase()} ${result.versionName} (${result.versionCode})\n`,
  );
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[app-release] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { DOWNLOAD_URL, main, readManifest, reconcile };
