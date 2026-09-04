'use strict';

// One-time GK9000 recovery requested by the owner on 2026-09-04.
// This file is removed immediately after the reset has been verified.
const fs = require('fs');
const path = require('path');
const { randomBytes, scryptSync } = require('crypto');
const Database = require('better-sqlite3');

const confirmation = 'RESET_BOTH_TO_1234_20260904';
if (process.env.SMART_CONTROL_AUTH_RESET_CONFIRMATION !== confirmation) {
  throw new Error('Refusing auth reset without the exact one-time confirmation.');
}

const projectRoot = path.resolve(__dirname, '..', '..');
const dbPath = process.env.DB_PATH || path.join(projectRoot, 'database', 'smart-control.db');
const markerPath = path.join(path.dirname(dbPath), '.auth-reset-20260904.done');
const backupDir = path.join(projectRoot, 'backups', 'auth-reset-20260904');

function hashPassword(plain) {
  const n = 16384;
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64, { N: n }).toString('hex');
  return `scrypt$${n}$${salt}$${hash}`;
}

async function main() {
  if (fs.existsSync(markerPath)) {
    console.log('Auth reset already completed; skipping.');
    return;
  }
  if (!fs.existsSync(dbPath)) throw new Error(`Production database not found: ${dbPath}`);

  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `smart-control-${Date.now()}.db`);
  const db = new Database(dbPath);
  try {
    await db.backup(backupPath);
    const now = new Date().toISOString();
    const update = db.transaction(() => {
      const client = db.prepare(
        'UPDATE client_auth_v1 SET passwordHash = ?, passwordChangedAt = ?, tokenSecret = ?, updatedAt = ? WHERE id = 1',
      ).run(hashPassword('1234'), now, randomBytes(32).toString('hex'), now);
      const admin = db.prepare(
        'UPDATE admin_auth_v1 SET passwordHash = ?, passwordChangedAt = ?, tokenSecret = ?, updatedAt = ? WHERE id = 1',
      ).run(hashPassword('1234'), now, randomBytes(32).toString('hex'), now);
      if (client.changes !== 1 || admin.changes !== 1) {
        throw new Error(`Expected one auth row each; client=${client.changes}, admin=${admin.changes}`);
      }
    });
    update();
    fs.writeFileSync(markerPath, `${now}\n${backupPath}\n`, { flag: 'wx' });
    console.log(`Auth reset completed; pre-write backup: ${backupPath}`);
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
