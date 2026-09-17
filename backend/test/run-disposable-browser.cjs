// Run only against a fresh disposable DB/media tree; never load the project's .env.
require('reflect-metadata');
const { DataSource } = require('typeorm');
const { mkdtemp, open } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { resolve, join } = require('node:path');
const { randomBytes, createHash, createHmac } = require('node:crypto');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const net = require('node:net');
const { provisionFirstAdmin } = require('../scripts/provision-first-admin.cjs');
const { ClientAuth } = require('../dist/entities/client-auth.entity');
const { HardwareUnit } = require('../dist/entities/hardware-unit.entity');
const { LightZone } = require('../dist/entities/light-zone.entity');
const { LightGroup } = require('../dist/entities/light-group.entity');

async function main() {
  const probe = net.createServer();
  await new Promise((ok, fail) => { probe.once('error', fail); probe.listen(33291, '127.0.0.1', ok); });
  await new Promise(ok => probe.close(ok));
  const root = await mkdtemp(join(tmpdir(), 'smart-control-browser-'));
  const password = `Test1-${randomBytes(24).toString('hex')}`;
  const adminUsername = 'browser_owner';
  let legacyClientToken = '';
  let legacyClientExpiresAt = '';
  const playerToken = randomBytes(32).toString('hex');
  const extraPlayerTokens = { 2: randomBytes(32).toString('hex'), 3: randomBytes(32).toString('hex') };
  const db = await new DataSource({ type: 'better-sqlite3', database: join(root, 'test.sqlite'),
    synchronize: false, entities: [resolve(__dirname, '../dist/entities/*.entity.js')],
    migrations: [resolve(__dirname, '../dist/migrations/*.js')],
  }).initialize();
  try {
    await db.runMigrations();
    const legacyAuthority = await db.getRepository(ClientAuth).findOneByOrFail({ id: 1 });
    const issuedAt = Date.now();
    legacyClientExpiresAt = new Date(issuedAt + 60 * 60 * 1000).toISOString();
    const payload = Buffer.from(JSON.stringify({ iat: issuedAt, exp: Date.parse(legacyClientExpiresAt) })).toString('base64url');
    legacyClientToken = `${payload}.${createHmac('sha256', legacyAuthority.tokenSecret).update(payload).digest('hex')}`;
    // A real control-page fixture backed only by the explicitly MOCK adapter.
    await db.getRepository(HardwareUnit).save({ code: 'BROWSER-MOCK-GW', name: 'Browser mock gateway', category: 'dali-gateway', vendor: 'test', model: 'mock', addressing: JSON.stringify({ slaveId: 1 }) });
    await db.getRepository(LightZone).save({ code: 'browser-control-test', name: 'Browser test lighting', floor: '1F', enabled: true });
    await db.getRepository(LightGroup).save({ gatewayCode: 'BROWSER-MOCK-GW', daliGroup: 1, zoneCode: 'browser-control-test', enabled: true });
  } finally { await db.destroy(); }
  // Fresh databases must satisfy the same explicit identity authority gate as
  // production. Provision through the supported one-time path; never bypass
  // startup readiness checks just because this database is disposable.
  provisionFirstAdmin({ databasePath: join(root, 'test.sqlite'), username: adminUsername, password });
  const output = await open(join(root, 'backend.log'), 'wx');
  const server = spawn(process.execPath, [resolve(__dirname, '../dist/main.js')], { cwd: root,
    env: { PATH: process.env.PATH, DB_PATH: join(root, 'test.sqlite'), MEDIA_ROOT: join(root, 'media'),
      LOG_DIR: join(root, 'logs'), DB_SYNCHRONIZE: 'false', MOCK_MODE: 'true', BIND_HOST: '127.0.0.1', PORT: '33291',
      PLAYER_DEVICE_CREDENTIALS: JSON.stringify(Object.entries({ 1: playerToken, ...extraPlayerTokens }).map(([slot, token]) => ({
        id: `disposable-kiosk-${slot}`, sha256: createHash('sha256').update(token).digest('hex'), slots: [Number(slot)], enabled: true,
      }))) },
    stdio: ['ignore', output.fd, output.fd],
  });
  const serverExit = once(server, 'exit');
  try {
    let ready = false;
    for (let i = 0; i < 100; i++) {
      if (server.exitCode !== null) throw new Error('Disposable backend exited before readiness');
      try {
        const response = await fetch('http://127.0.0.1:33291/api/client-auth/ping', { signal: AbortSignal.timeout(500) });
        const json = await response.json();
        if (response.ok && json.data?.ok === true && json.data?.service === 'client-auth') { ready = true; break; }
      } catch { /* Startup can take several seconds. */ }
      await new Promise(ok => setTimeout(ok, 200));
    }
    if (!ready) throw new Error('Disposable backend readiness timed out');
    const runner = spawn(process.execPath, [resolve(__dirname, '../../frontend/tests/app-media-browser-smoke.cjs')], {
      cwd: root, env: { ...process.env, SC_DISPOSABLE_BACKEND: 'yes', SC_SMOKE_ADMIN_PASSWORD: password, SC_SMOKE_PLAYER_TOKEN: playerToken,
        SC_SMOKE_ADMIN_USERNAME: adminUsername, SC_SMOKE_LEGACY_TOKEN: legacyClientToken,
        SC_SMOKE_LEGACY_TOKEN_EXPIRES_AT: legacyClientExpiresAt,
        SC_SMOKE_EXTRA_PLAYER_TOKENS: JSON.stringify(extraPlayerTokens) }, stdio: 'inherit',
    });
    const [code] = await once(runner, 'exit');
    if (code !== 0) throw new Error('Built application browser acceptance failed');
    const evidenceDb = await new DataSource({ type: 'better-sqlite3', database: join(root, 'test.sqlite'),
      synchronize: false, entities: [resolve(__dirname, '../dist/entities/*.entity.js')],
    }).initialize();
    try {
      const [latest] = await evidenceDb.query(
        `SELECT actor, source FROM runtime_config_revisions
         WHERE config_key = ? ORDER BY revision DESC LIMIT 1`,
        ['video.binding'],
      );
      if (!latest || !String(latest.actor).includes(adminUsername)) {
        throw new Error('Video binding revision did not retain the named administrator audit actor');
      }
      if (latest.source !== 'PUT /api/video-binding/ai/box') {
        throw new Error('Video binding revision did not retain the stable API source');
      }
    } finally { await evidenceDb.destroy(); }
    console.log('PASS fresh migrations + real loopback backend + built application browser acceptance');
  } finally {
    if (server.exitCode === null) server.kill('SIGTERM');
    const hardStop = setTimeout(() => { if (server.exitCode === null) server.kill('SIGKILL'); }, 5000);
    await serverExit;
    clearTimeout(hardStop);
    await output.close();
    console.log(`Disposable evidence retained: ${root}`);
  }
}
main().catch(error => { console.error(error?.stack || error?.message || error); process.exitCode = 1; });
