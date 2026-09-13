// Invoked with the current provisioner loaded in memory. Never use live profiles.
module.exports = async function run(configureProfile) {
  const fs = require('node:fs/promises'), path = require('node:path'), http = require('node:http');
  const { tmpdir } = require('node:os'), { randomBytes } = require('node:crypto');
  if (process.platform !== 'win32') throw new Error('Windows fixture required');
  let executable;
  for (const candidate of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) {
    try { await fs.access(candidate); executable = candidate; break; } catch {}
  }
  if (!executable) throw new Error('No test browser available');
  const root = await fs.mkdtemp(path.join(tmpdir(), 'sc-kiosk-windows-fixture-'));
  const token = randomBytes(32).toString('hex');
  let persistedSeen = false, origin;
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/player-device/')) {
      res.writeHead(req.headers['x-player-token'] === token ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end('{"data":{"slot":1}}');
    } else if (req.url.startsWith('/persisted')) {
      if (req.url === '/persisted?ok=true') persistedSeen = true;
      res.end('ok');
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      const key = `sc.player.credential:${origin}/api:1`;
      res.end('<!doctype html><title>Synthetic isolated fixture</title><script>fetch("/persisted?ok="+(localStorage.getItem(' + JSON.stringify(key) + ')===' + JSON.stringify(token) + '))</script>');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const options = { executable, profile: path.join(root, 'profile'), origin, apiOrigin: origin, slot: 1, token };
    await configureProfile(options);
    let rejected = false;
    try { await configureProfile({ ...options, token: 'f'.repeat(64) }); } catch { rejected = true; }
    if (!rejected || !persistedSeen) throw new Error('Credential rejection or persistent restart check failed');
    console.log('PASS Windows headless profile: accepted credential persists across restart; invalid credential rejected; production profiles untouched.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
};
