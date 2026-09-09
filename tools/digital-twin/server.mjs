import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const job = process.env.TWIN_JOB ? path.resolve(process.env.TWIN_JOB) : null;
const port = Number(process.env.TWIN_PORT ?? 5199);
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.glb': 'model/gltf-binary', '.css': 'text/css' };
http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  if (!['127.0.0.1', 'localhost'].includes((req.headers.host ?? '').split(':')[0])) { res.writeHead(403).end(); return; }
  try {
    const route = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname);
    if (route === '/api/job') {
      const report = job ? JSON.parse(await fs.readFile(path.join(job, 'intake.json'), 'utf8')) : null;
      res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(report)); return;
    }
    let base, relative;
    if (route.startsWith('/vendor/')) { base = path.join(here, 'node_modules/three'); relative = route.slice('/vendor/'.length); }
    else if (['/preview/scene.glb', '/preview/twin-manifest.json'].includes(route) && job) { base = path.join(job, 'preview'); relative = route.slice('/preview/'.length); }
    else { base = path.join(here, 'web'); relative = route === '/' ? 'index.html' : route.slice(1); }
    const file = path.resolve(base, relative);
    if (!file.startsWith(base + path.sep)) { res.writeHead(403).end(); return; }
    const real = await fs.realpath(file);
    if (!real.startsWith((await fs.realpath(base)) + path.sep)) { res.writeHead(403).end(); return; }
    const data = await fs.readFile(real);
    res.setHeader('Content-Type', contentTypes[path.extname(file)] ?? 'application/octet-stream');
    res.setHeader('Content-Length', data.length);
    res.end(req.method === 'HEAD' ? undefined : data);
  } catch { res.writeHead(404).end('Not found'); }
}).listen(port, '127.0.0.1', () => console.log(`Twin workbench: http://127.0.0.1:${port}`));
