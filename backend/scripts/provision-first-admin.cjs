'use strict';

const { randomBytes, scryptSync } = require('node:crypto');
const path = require('node:path');
const Database = require('better-sqlite3');
const { resolveProductionDatabasePath } = require('./production-paths.cjs');

const MIGRATION = 'EstablishNamedIdentityAuthority1789650000000';

function hashPassword(plain) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(plain, salt, 64, { N: 16384 }).toString('hex');
  return `scrypt$16384$${salt}$${hash}`;
}

function validate(username, password) {
  if (typeof username !== 'string' || username.length < 2 || username.length > 64 || username.trim() !== username) {
    throw new Error('SC_ADMIN_USERNAME must be 2-64 characters without leading or trailing spaces');
  }
  if (typeof password !== 'string' || password.length < 12 || password.length > 128) {
    throw new Error('SC_ADMIN_PASSWORD must be 12-128 characters');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('SC_ADMIN_PASSWORD must contain letters and numbers');
  }
}

function provisionFirstAdmin({ databasePath, username, password }) {
  validate(username, password);
  const db = new Database(databasePath);
  try {
    db.pragma('foreign_keys = ON');
    const migrate = db.prepare('SELECT 1 FROM migrations WHERE name = ?').get(MIGRATION);
    if (!migrate) throw new Error(`Required migration is not applied: ${MIGRATION}`);
    const provision = db.transaction(() => {
      const existing = db.prepare("SELECT id FROM users WHERE role = 'admin' AND enabled = 1 LIMIT 1").get();
      if (existing) throw new Error('An enabled named administrator already exists; use User Management to rotate credentials');
      const duplicate = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
      if (duplicate) throw new Error('The requested username already exists');
      db.prepare(
        `INSERT INTO users (username, password, role, enabled, created_at, updated_at)
         VALUES (?, ?, 'admin', 1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      ).run(username, hashPassword(password));
      return db.prepare('SELECT id, username, role, enabled FROM users WHERE username = ?').get(username);
    });
    return provision.immediate();
  } finally {
    db.close();
  }
}

function main() {
  const username = String(process.env.SC_ADMIN_USERNAME || '').trim();
  const password = process.env.SC_ADMIN_PASSWORD;
  const databasePath = resolveProductionDatabasePath({ cwd: process.cwd() });
  const result = provisionFirstAdmin({ databasePath, username, password });
  console.log(`First named administrator created: ${result.username} (database: ${path.basename(databasePath)})`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    console.error(`Administrator provisioning refused: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

module.exports = { provisionFirstAdmin };
