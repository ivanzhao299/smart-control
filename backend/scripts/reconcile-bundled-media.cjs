#!/usr/bin/env node
'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const Database = require('better-sqlite3');
const { loadEnvFile } = require('./run-migrations.js');
const {
  resolveProductionDatabasePath,
  resolveProductionMediaRoot,
} = require('./production-paths.cjs');

const KINDS = new Set(['video', 'image', 'audio', 'doc']);
const KEY_PATTERN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return Boolean(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function readManifest(manifestPath) {
  const document = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  if (document.schemaVersion !== 1 || document.catalogVersion !== 1 || !Array.isArray(document.assets)) {
    throw new Error('Unsupported bundled media manifest');
  }
  const keys = new Set();
  const names = new Set();
  const manifestStat = fs.lstatSync(manifestPath);
  if (!manifestStat.isFile() || manifestStat.isSymbolicLink()) {
    throw new Error('Bundled media manifest is not a regular file');
  }
  const manifestRoot = fs.realpathSync(path.dirname(manifestPath));
  const assets = document.assets.map((item) => {
    if (!item || typeof item !== 'object' || !KEY_PATTERN.test(item.key || '')) {
      throw new Error('Bundled media key is invalid');
    }
    if (keys.has(item.key)) throw new Error(`Duplicate bundled media key: ${item.key}`);
    if (typeof item.originalName !== 'string' || !item.originalName || names.has(item.originalName)) {
      throw new Error(`Bundled media name is invalid or duplicated: ${item.key}`);
    }
    keys.add(item.key);
    names.add(item.originalName);
    if (item.type === 'webpage') {
      if (!/^http:\/\/localhost:5173\/control\/[a-z0-9/-]+\.html$/.test(item.sourceUrl || '')) {
        throw new Error(`Bundled webpage URL is invalid: ${item.key}`);
      }
      return { ...item };
    }
    if (item.type !== 'file' || !KINDS.has(item.kind) || typeof item.mimeType !== 'string') {
      throw new Error(`Bundled file metadata is invalid: ${item.key}`);
    }
    if (!Number.isSafeInteger(item.size) || item.size < 1 || !/^[a-f0-9]{64}$/.test(item.sha256 || '')) {
      throw new Error(`Bundled file digest is invalid: ${item.key}`);
    }
    if (typeof item.artifact !== 'string' || path.isAbsolute(item.artifact)) {
      throw new Error(`Bundled artifact path is invalid: ${item.key}`);
    }
    const requestedArtifact = path.resolve(manifestRoot, item.artifact);
    if (!isInside(manifestRoot, requestedArtifact)) throw new Error(`Bundled artifact escapes its root: ${item.key}`);
    const artifactPath = fs.realpathSync(requestedArtifact);
    if (!isInside(manifestRoot, artifactPath)) throw new Error(`Bundled artifact resolves outside its root: ${item.key}`);
    const stat = fs.lstatSync(artifactPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) {
      throw new Error(`Bundled artifact is not an independent regular file: ${item.key}`);
    }
    if (stat.size !== item.size || sha256(artifactPath) !== item.sha256) {
      throw new Error(`Bundled artifact checksum mismatch: ${item.key}`);
    }
    return { ...item, artifactPath };
  });
  if (assets.length !== 15) throw new Error('Bundled media manifest must contain 15 assets');
  return { catalogVersion: document.catalogVersion, assets };
}

function reconcile(options) {
  const catalog = readManifest(options.manifestPath);
  if (!path.isAbsolute(options.mediaRoot)) throw new Error('MEDIA_ROOT must be absolute');
  if (!options.checkOnly) fs.mkdirSync(options.mediaRoot, { recursive: true });
  const configuredRootStat = fs.lstatSync(options.mediaRoot);
  if (!configuredRootStat.isDirectory() || configuredRootStat.isSymbolicLink()) {
    throw new Error('MEDIA_ROOT is not a safe directory');
  }
  const mediaRoot = fs.realpathSync(options.mediaRoot);
  const mediaRootStat = fs.lstatSync(mediaRoot);
  if (!mediaRootStat.isDirectory() || mediaRootStat.isSymbolicLink()) {
    throw new Error('MEDIA_ROOT is not a safe directory');
  }
  const db = new Database(options.databasePath, {
    readonly: Boolean(options.checkOnly),
    fileMustExist: true,
  });
  const createdFiles = [];
  const createdDirectories = [];
  try {
    if (options.checkOnly) db.pragma('query_only = ON');
    const columns = new Set(db.prepare('PRAGMA table_info(media_assets)').all().map((row) => row.name));
    for (const column of ['system_key', 'artifact_sha256']) {
      if (!columns.has(column)) throw new Error(`Bundled media migration is missing ${column}`);
    }

    let changed = false;
    const apply = () => {
      for (const asset of catalog.assets) {
        const keyed = db.prepare('SELECT * FROM media_assets WHERE system_key = ?').all(asset.key);
        if (keyed.length > 1) throw new Error(`Duplicate bundled media identity: ${asset.key}`);
        const legacy = keyed.length
          ? []
          : db
              .prepare(
                `SELECT * FROM media_assets
                 WHERE owner_user_id IS NULL AND source = 'system' AND originalName = ?`,
              )
              .all(asset.originalName);
        if (legacy.length > 1) throw new Error(`Duplicate bundled media name: ${asset.key}`);
        let row = keyed[0] || legacy[0];

        if (asset.type === 'webpage') {
          if (!row) throw new Error(`Bundled webpage is missing after migration: ${asset.key}`);
          assertCommonRow(row, asset);
          if (
            row.kind !== 'webpage' ||
            row.sourceUrl !== asset.sourceUrl ||
            row.path !== '' ||
            row.mimeType !== 'text/html' ||
            Number(row.sizeBytes) !== 0
          ) {
            throw new Error(`Bundled webpage conflicts with manifest: ${asset.key}`);
          }
          if (row.system_key !== asset.key || row.artifact_sha256 !== null) {
            if (options.checkOnly) throw new Error(`Bundled webpage reconciliation is pending: ${asset.key}`);
            db.prepare(
              `UPDATE media_assets SET system_key = ?, artifact_sha256 = NULL WHERE id = ?`,
            ).run(asset.key, row.id);
            changed = true;
          }
          continue;
        }

        if (row) {
          assertCommonRow(row, asset);
          if (row.kind !== asset.kind || row.mimeType !== asset.mimeType) {
            throw new Error(`Bundled file metadata conflicts with manifest: ${asset.key}`);
          }
        } else if (options.checkOnly) {
          throw new Error(`Bundled file is missing: ${asset.key}`);
        } else {
          const result = db
            .prepare(
              `INSERT INTO media_assets
               (owner_user_id, visibility, source, system_key, artifact_sha256,
                originalName, safeName, path, sourcePath, processingStatus, processingError,
                thumbPath, kind, sourceUrl, mimeType, sizeBytes, durationSec, resolution,
                remark, uploader, pageCount, docPdfPath, last_played_at, created_at, updated_at)
               VALUES
               (NULL, 'shared', 'system', ?, ?, ?, ?, '', NULL, 'ready', NULL, NULL,
                ?, NULL, ?, ?, NULL, NULL, ?, 'system', NULL, NULL, NULL,
                CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
            )
            .run(
              asset.key,
              asset.sha256,
              asset.originalName,
              safeFilename(asset.originalName),
              asset.kind,
              asset.mimeType,
              asset.size,
              asset.remark,
            );
          row = db.prepare('SELECT * FROM media_assets WHERE id = ?').get(result.lastInsertRowid);
          changed = true;
        }

        let liveMatches = false;
        if (row.path) {
          try {
            const livePath = fs.realpathSync(row.path);
            const stat = fs.lstatSync(livePath);
            liveMatches =
              isInside(mediaRoot, livePath) &&
              stat.isFile() &&
              !stat.isSymbolicLink() &&
              stat.nlink === 1 &&
              stat.size === asset.size &&
              sha256(livePath) === asset.sha256;
          } catch {
            liveMatches = false;
          }
        }
        if (options.checkOnly && !liveMatches) {
          throw new Error(`Bundled media file reconciliation is pending: ${asset.key}`);
        }

        let finalPath = row.path;
        if (!liveMatches) {
          const directory = path.join(mediaRoot, '_system', asset.key);
          ensureOwnedDirectory(directory, mediaRoot, createdDirectories);
          finalPath = path.join(directory, `${asset.sha256.slice(0, 16)}-${safeFilename(asset.originalName)}`);
          if (fs.existsSync(finalPath)) {
            const stat = fs.lstatSync(finalPath);
            if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size !== asset.size || sha256(finalPath) !== asset.sha256) {
              throw new Error(`Bundled media target is occupied: ${asset.key}`);
            }
          } else {
            const temporary = `${finalPath}.stage-${process.pid}-${crypto.randomUUID()}`;
            fs.copyFileSync(asset.artifactPath, temporary, fs.constants.COPYFILE_EXCL);
            createdFiles.push(temporary);
            if (sha256(temporary) !== asset.sha256) throw new Error(`Bundled media staging failed: ${asset.key}`);
            fs.renameSync(temporary, finalPath);
            createdFiles[createdFiles.indexOf(temporary)] = finalPath;
          }
          changed = true;
        }

        const metadataMatches =
          row.system_key === asset.key &&
          String(row.artifact_sha256 || '').toLowerCase() === asset.sha256 &&
          Number(row.sizeBytes) === asset.size &&
          row.path === finalPath;
        if (!metadataMatches) {
          if (options.checkOnly) throw new Error(`Bundled media metadata reconciliation is pending: ${asset.key}`);
          db.prepare(
            `UPDATE media_assets
             SET system_key = ?, artifact_sha256 = ?, path = ?, sizeBytes = ?
             WHERE id = ?`,
          ).run(asset.key, asset.sha256, finalPath, asset.size, row.id);
          changed = true;
        }
      }
      const systemRows = db.prepare(`SELECT id, system_key FROM media_assets WHERE source = 'system'`).all();
      const expectedKeys = new Set(catalog.assets.map((asset) => asset.key));
      if (
        systemRows.length !== expectedKeys.size ||
        systemRows.some((row) => !expectedKeys.has(row.system_key))
      ) {
        throw new Error('Uncatalogued system media exists');
      }
    };
    if (options.checkOnly) apply();
    else db.transaction(apply).immediate();
    return { state: changed ? 'updated' : 'current', count: catalog.assets.length };
  } catch (error) {
    for (const file of createdFiles.reverse()) {
      try { fs.unlinkSync(file); } catch {}
    }
    for (const directory of createdDirectories.reverse()) {
      try { fs.rmdirSync(directory); } catch {}
    }
    throw error;
  } finally {
    db.close();
  }
}

function assertCommonRow(row, asset) {
  if (
    row.originalName !== asset.originalName ||
    row.owner_user_id !== null ||
    row.visibility !== 'shared' ||
    row.source !== 'system' ||
    row.uploader !== 'system' ||
    row.remark !== asset.remark ||
    (asset.type === 'webpage' && row.resolution !== asset.resolution)
  ) {
    throw new Error(`Bundled media ownership conflicts with manifest: ${asset.key}`);
  }
}

function ensureOwnedDirectory(directory, mediaRoot, createdDirectories) {
  const parent = path.dirname(directory);
  if (!isInside(mediaRoot, parent) || !isInside(mediaRoot, directory)) {
    throw new Error('Bundled media directory escapes MEDIA_ROOT');
  }
  if (!fs.existsSync(parent)) {
    fs.mkdirSync(parent);
    createdDirectories.push(parent);
  }
  const parentStat = fs.lstatSync(parent);
  const parentReal = fs.realpathSync(parent);
  if (!parentStat.isDirectory() || parentStat.isSymbolicLink() || !isInside(mediaRoot, parentReal)) {
    throw new Error('Bundled media parent directory is unsafe');
  }
  if (!fs.existsSync(directory)) {
    fs.mkdirSync(directory);
    createdDirectories.push(directory);
  }
  const directoryReal = fs.realpathSync(directory);
  if (!isInside(mediaRoot, directoryReal)) {
    throw new Error('Bundled media directory escapes MEDIA_ROOT');
  }
  const directoryStat = fs.lstatSync(directory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error('Bundled media directory is unsafe');
}

function safeFilename(name) {
  return name.replace(/[\x00-\x1f\\/:*?"<>|]+/g, '_').replace(/\s+/g, '_').slice(0, 200) || 'asset';
}

function parseArgs(argv) {
  const args = { checkOnly: false };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--check-only') args.checkOnly = true;
    else if (token === '--manifest') args.manifestPath = argv[++index];
    else throw new Error(`Unknown argument: ${token}`);
  }
  if (!args.manifestPath) throw new Error('Required: --manifest <path>');
  return args;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  loadEnvFile(process.cwd());
  const result = reconcile({
    ...args,
    manifestPath: path.resolve(args.manifestPath),
    databasePath: resolveProductionDatabasePath({ cwd: process.cwd() }),
    mediaRoot: resolveProductionMediaRoot({ cwd: process.cwd() }),
  });
  process.stdout.write(`BUNDLED_MEDIA_${result.state.toUpperCase()} ${result.count}\n`);
  return result;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`[bundled-media] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { main, readManifest, reconcile };
