// Local acceptance only. No proxy and no writable route to production.
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/public/park-ops');
const port = Number(process.env.OPS_PORT || 5200);
const snapshotPath = process.env.OPS_LAYOUT_SNAPSHOT;
if (!snapshotPath) throw Error('Set OPS_LAYOUT_SNAPSHOT to a reviewed read-only production layout snapshot');
const snapshot = await fs.readFile(snapshotPath);
if (!JSON.parse(snapshot).data?.config) throw Error('Production layout snapshot is missing config; do not silently use defaults');
const displaySource = process.env.OPS_DISPLAY_SOURCE ? await fs.readFile(process.env.OPS_DISPLAY_SOURCE) : null;
const baselineHTML = process.env.OPS_BASELINE_HTML ? await fs.readFile(process.env.OPS_BASELINE_HTML) : null;
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.jpg': 'image/jpeg', '.glb': 'model/gltf-binary', '.png': 'image/png' };
http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['localhost', '127.0.0.1'].includes((req.headers.host || '').split(':')[0])) return res.writeHead(403).end();
  if (!['GET', 'HEAD'].includes(req.method)) return res.writeHead(405).end('Local preview is read-only');
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/api/system-branding/park-ops') { res.setHeader('Content-Type', 'application/json'); return res.end(req.method === 'HEAD' ? undefined : snapshot); }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/screen/index.html' }); return res.end(); }
    if (!url.pathname.startsWith('/screen/')) return res.writeHead(404).end();
    const target = path.resolve(root, decodeURIComponent(url.pathname.slice(8)));
    const real = await fs.realpath(target);
    if (!real.startsWith(root + path.sep)) return res.writeHead(403).end();
    const data = baselineHTML && url.searchParams.get('baseline') === '1' && real === path.join(root, 'index.html') ? baselineHTML : displaySource && real === path.join(root, 'park-ops-3d.js') ? displaySource : await fs.readFile(real);
    res.setHeader('Content-Type', mime[path.extname(real)] || 'application/octet-stream');
    res.setHeader('Content-Length', data.length); res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Business preview (production map snapshot, READ ONLY): http://127.0.0.1:${port}/screen/index.html`));
