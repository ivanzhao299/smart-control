// Headed profile provisioning using the timing proven by diag-storage.cjs:
// setItem -> close -> fixed wait -> walk -> search (NOT poll-while-locked).
// Must run inside the interactive console session. Configures slots 1 and 2.
const fs = require('node:fs/promises');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const WebSocket = require('ws');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const CRED = 'C:\\ProgramData\\Anksen\\smart-control-player-credentials\\native.token';

async function walkFiles(root) {
  const out = [];
  async function rec(dir) {
    let items = [];
    try { items = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const it of items) {
      const full = path.join(dir, it.name);
      if (it.isDirectory()) await rec(full);
      else { try { const st = await fs.stat(full); out.push({ rel: path.relative(root, full), mtime: st.mtimeMs }); } catch {} }
    }
  }
  await rec(root);
  return out;
}

async function provisionSlot(slot, token) {
  const profile = `C:\\Users\\user\\AppData\\Local\\smart-control-player-slot${slot}`;
  const key = 'sc.player.credential:/api:' + slot;
  const started = Date.now();
  const args = ['--no-first-run', '--no-default-browser-check', '--window-size=420,300',
    '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0',
    `--user-data-dir=${profile}`, 'about:blank'];
  spawn(EDGE, args, { stdio: 'ignore' }); // first process is a launcher stub; ignore its exit
  let endpoint;
  for (let i = 0; i < 200; i++) {
    try {
      const file = path.join(profile, 'DevToolsActivePort');
      const stat = await fs.stat(file);
      const [port, route] = (await fs.readFile(file, 'utf8')).trim().split(/\r?\n/);
      if (stat.mtimeMs >= started && /^\d+$/.test(port) && /^\/devtools\/browser\//.test(route)) { endpoint = `ws://127.0.0.1:${port}${route}`; break; }
    } catch {}
    await new Promise(r => setTimeout(r, 100));
  }
  if (!endpoint) throw new Error('slot' + slot + ' no endpoint');
  const sock = new WebSocket(endpoint);
  sock.on('error', () => {});
  let id = 0; const pend = new Map();
  const call = (m, p = {}, sid) => new Promise((res, rej) => {
    const my = ++id;
    sock.send(JSON.stringify({ id: my, method: m, params: p, ...(sid ? { sessionId: sid } : {}) }));
    pend.set(my, { res, rej });
  });
  sock.on('message', b => { let m; try { m = JSON.parse(b); } catch { return; } if (pend.has(m.id)) { const w = pend.get(m.id); pend.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } });
  await once(sock, 'open');
  const t = await call('Target.createTarget', { url: `http://localhost:5173/control/player?slot=${slot}` });
  const a = await call('Target.attachToTarget', { targetId: t.targetId, flatten: true });
  const sid = a.sessionId;
  let ready = false;
  for (let i = 0; i < 80; i++) {
    const st = await call('Runtime.evaluate', { expression: 'location.origin', returnByValue: true }, sid);
    if (st.result && st.result.value === 'http://localhost:5173') { ready = true; break; }
    await new Promise(r => setTimeout(r, 100));
  }
  if (!ready) throw new Error('slot' + slot + ' page not ready');
  // Validate the token same-origin, then persist it.
  const expression = `(async()=>{const t=${JSON.stringify(token)};const r=await fetch('/api/player-device/${slot}/state',{headers:{'X-Player-Token':t},credentials:'omit',cache:'no-store'});if(!r.ok)return 'FETCH_FAIL';localStorage.setItem(${JSON.stringify(key)},t);return localStorage.getItem(${JSON.stringify(key)})===t?'SET':'READBACK_MISMATCH';})()`;
  const ev = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sid);
  if (!ev.result || ev.result.value !== 'SET') throw new Error('slot' + slot + ' credential step: ' + (ev.result && ev.result.value));
  await new Promise(r => setTimeout(r, 500));
  await call('Browser.close').catch(() => {});
  // Fixed wait for shutdown + flush, then walk and search once.
  await new Promise(r => setTimeout(r, 4000));
  const files = await walkFiles(profile);
  let persisted = false;
  for (const f of files) {
    if (f.mtime < started - 500) continue;
    try {
      const b = await fs.readFile(path.join(profile, f.rel));
      if (b.toString('utf16le').includes(key) || b.toString('latin1').includes(key)) persisted = true;
    } catch {}
  }
  if (!persisted) throw new Error('slot' + slot + ' not on disk');
  console.log(`slot${slot}: credential persisted`);
}

async function main() {
  const token = (await fs.readFile(CRED, 'utf8')).trim();
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('bad native token');
  for (const s of [1, 2]) await provisionSlot(s, token);
  console.log('ALL_SLOTS_CONFIGURED');
}
main().catch(e => { console.log('FAILED: ' + e.message); process.exit(1); });
