const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { randomBytes } = require('node:crypto');
const { configureProfile } = require('../scripts/provision-kiosk-profiles.cjs');

test('real dedicated browser profile persists only accepted credentials across process restart', {
  skip: process.env.SC_KIOSK_PROFILE_TEST !== '1', timeout: 90000,
}, async () => {
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
  const executable = process.env.SC_KIOSK_BROWSER_EXECUTABLE;
  assert.ok(executable, 'An explicit test browser executable is required');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sc-kiosk-profile-'));
  const token = randomBytes(32).toString('hex');
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/player-device/')) {
      res.writeHead(req.headers['x-player-token'] === token ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ data: { slot: 1 } }));
    } else { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<!doctype html><title>Isolated kiosk fixture</title>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const profile = path.join(root, 'profile');
  const options = { executable, profile, origin, apiOrigin: origin, slot: 1, token };
  try {
    assert.equal(await configureProfile(options), true);
    await assert.rejects(configureProfile({ ...options, token: 'f'.repeat(64) }), /not accepted/);
    const browser = await chromium.launchPersistentContext(profile, { executablePath: executable, headless: true });
    try {
      const page = await browser.newPage(); await page.goto(origin);
      const stored = await page.evaluate(key => localStorage.getItem(key), `sc.player.credential:${origin}/api:1`);
      assert.ok(stored === token, 'Accepted credential survives restart; invalid replacement cannot overwrite it');
      assert.equal(await page.evaluate(key => localStorage.getItem(key), `sc.player.credential:${origin}/api:2`), null);
    } finally { await browser.close(); }
  } finally { await new Promise(resolve => server.close(resolve)); await fs.rm(root, { recursive: true, force: true }); }
});
