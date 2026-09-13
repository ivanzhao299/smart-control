// Configure dedicated kiosk profiles without tokens in URLs, arguments or logs.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn, execFileSync } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

async function configureProfile({ executable, profile, origin, apiOrigin, slot, token }) {
  if (![1, 2].includes(slot) || !/^[a-f0-9]{64}$/.test(token)) throw new Error('Invalid kiosk configuration');
  for (const value of [origin, apiOrigin]) {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname) || url.username || url.password) {
      throw new Error('Kiosk provisioning requires loopback origins');
    }
  }
  await fs.mkdir(profile, { recursive: true });
  const started = Date.now();
  const child = spawn(executable, ['--headless=new', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'],
  { stdio: 'ignore' });
  let spawnError;
  child.on('error', () => { spawnError = true; });
  let socket;
  const pending = new Map();
  let nextId = 0;
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++nextId;
    const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Kiosk protocol timed out')); }, 10000);
    pending.set(id, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  try {
    let endpoint;
    for (let i = 0; i < 100; i++) {
      if (spawnError || child.exitCode !== null) throw new Error('Dedicated browser could not start; profile may be in use');
      try {
        const file = path.join(profile, 'DevToolsActivePort');
        const stat = await fs.stat(file);
        const [port, route] = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/);
        if (stat.mtimeMs >= started && /^\d+$/.test(port) && /^\/devtools\/browser\/[a-f0-9-]+$/.test(route)) {
          endpoint = `ws://127.0.0.1:${port}${route}`; break;
        }
      } catch { /* Browser may not have published its endpoint yet. */ }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!endpoint) throw new Error('No fresh dedicated browser endpoint');
    socket = new WebSocket(endpoint);
    socket.on('error', () => {});
    socket.on('message', bytes => {
      let message; try { message = JSON.parse(bytes.toString()); } catch { return; }
      const waiter = pending.get(message.id); if (!waiter) return;
      pending.delete(message.id); clearTimeout(waiter.timeout);
      if (message.error) waiter.reject(new Error('Kiosk protocol command failed'));
      else waiter.resolve(message.result);
    });
    let connectionTimer;
    try {
      await Promise.race([once(socket, 'open'), new Promise((_, reject) => {
        connectionTimer = setTimeout(() => reject(new Error('Kiosk connection timed out')), 10000);
      })]);
    } finally { clearTimeout(connectionTimer); }
    const target = await call('Target.createTarget', { url: `${origin}/control/player?slot=${slot}` });
    const attached = await call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
    const session = attached.sessionId;
    let ready = false;
    for (let i = 0; i < 50; i++) {
      const state = await call('Runtime.evaluate', { expression: 'location.origin', returnByValue: true }, session);
      if (state.result?.value === origin) { ready = true; break; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    if (!ready) throw new Error('Kiosk did not reach the expected local origin');
    // Validate the credential before persisting; return only a boolean, not state.
    const expression = `(async()=>{const t=${JSON.stringify(token)};const r=await fetch(${JSON.stringify(apiOrigin + '/api/player-device/' + slot + '/state')},{headers:{'X-Player-Token':t},credentials:'omit',cache:'no-store',redirect:'error'});if(!r.ok)return false;localStorage.setItem(${JSON.stringify('sc.player.credential:' + apiOrigin + '/api:' + slot)},t);return true})()`;
    const configured = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
    if (configured.exceptionDetails || configured.result?.value !== true) throw new Error('Kiosk credential was not accepted');
    await call('Browser.close').catch(() => {});
    return true;
  } finally {
    if (socket?.readyState === WebSocket.OPEN) await call('Browser.close').catch(() => {});
    for (const waiter of pending.values()) { clearTimeout(waiter.timeout); waiter.reject(new Error('Kiosk session closed')); }
    pending.clear();
    if (socket) socket.terminate();
    if (child.exitCode === null) {
      await Promise.race([once(child, 'exit'), new Promise(resolve => setTimeout(resolve, 3000))]);
      if (child.exitCode === null) child.kill();
    }
  }
}

async function main() {
  const os = require('node:os');
  if (process.platform !== 'win32' || os.hostname().toUpperCase() !== 'GK9000' || os.userInfo().username.toLowerCase() !== 'user') {
    throw new Error('Dedicated GK9000 user profile required');
  }
  const preflight = "$ErrorActionPreference='Stop';if((Get-ScheduledTask -TaskName 'SmartControl-PlayerWatchdog').State -ne 'Disabled'){exit 1};$p=@(Get-CimInstance Win32_Process|Where-Object {$_.Name -in @('chrome.exe','msedge.exe') -and $_.CommandLine -match 'smart-control-player-slot[123]'});if($p.Count){exit 1};Write-Output 'PLAYERS_PAUSED'";
  const ready = execFileSync('powershell.exe', ['-NoProfile', '-EncodedCommand', Buffer.from(preflight, 'utf16le').toString('base64')],
    { encoding: 'utf8', timeout: 15000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (ready.trim() !== 'PLAYERS_PAUSED') throw new Error('Player profiles are not paused');
  let executable;
  for (const candidate of ['C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe']) {
    try { await fs.access(candidate); executable = candidate; break; } catch { /* Next installed browser. */ }
  }
  if (!executable) throw new Error('No supported kiosk browser');
  for (const slot of [1, 2]) {
    const token = (await fs.readFile(path.join('C:\\ProgramData\\Anksen\\smart-control-player-credentials', slot === 1 ? 'led.token' : 'projector.token'), 'utf8')).trim();
    await configureProfile({ executable, profile: `C:\\Users\\user\\AppData\\Local\\smart-control-player-slot${slot}`,
      origin: 'http://localhost:5173', apiOrigin: 'http://localhost:3200', slot, token });
  }
}
if (require.main === module) main().then(() => console.log('Dedicated kiosk profiles configured; physical playback still requires verification.')).catch(() => {
  console.error('Kiosk provisioning failed. Keep player tasks paused; no credentials printed.'); process.exitCode = 1;
});
module.exports = { configureProfile };
