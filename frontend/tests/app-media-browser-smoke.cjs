// Requires a disposable MOCK backend on 127.0.0.1:33291, never production.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const backend = 'http://127.0.0.1:33291/api';
async function api(route, method, body, token, admin = false) {
  const response = await fetch(backend + route, { method, redirect: 'error', headers: {
    'Content-Type': 'application/json', ...(token ? admin ? { Authorization: `Bearer ${token}` } : { 'X-Client-Token': token } : {}),
  }, body: body === undefined ? undefined : JSON.stringify(body) });
  assert.ok(response.ok, `${route}: HTTP ${response.status}`);
  return (await response.json()).data;
}
(async () => {
  assert.equal(process.env.SC_DISPOSABLE_BACKEND, 'yes', 'Explicit disposable backend confirmation required');
  assert.ok(process.env.SC_SMOKE_ADMIN_PASSWORD, 'Synthetic backend admin password required');
  const admin = (await api('/admin/auth/login', 'POST', { password: process.env.SC_SMOKE_ADMIN_PASSWORD })).token;
  const nonce = crypto.randomBytes(5).toString('hex');
  const accounts = {};
  for (const role of ['operator', 'viewer', 'admin']) {
    const username = `browser_${role}_${nonce}`, password = crypto.randomBytes(20).toString('hex');
    await api('/users', 'POST', { username, password, role }, admin, true);
    accounts[role] = await api('/client-auth/login', 'POST', { username, password });
  }
  const privateName = 'Private-' + nonce, sharedName = 'Shared-' + nonce;
  await api('/media/webpage', 'POST', { name: privateName, url: 'https://example.test/private' }, accounts.operator.token);
  const shared = await api('/media/webpage', 'POST', { name: sharedName, url: 'https://example.test/shared' }, admin, true);
  await api('/media/' + shared.id, 'PUT', { visibility: 'shared' }, admin, true);
  const root = path.resolve(__dirname, '../dist');
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/api/')) {
      const upstream = http.request('http://127.0.0.1:33291' + req.url, { method: req.method, headers: req.headers }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const requestPath = decodeURIComponent(req.url.split('?')[0]).replace(/^\/control\//, '/');
    let file = path.resolve(root, '.' + requestPath);
    if (!file.startsWith(root + path.sep)) file = path.join(root, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) file = path.join(root, 'index.html');
    const mime = { '.js': 'application/javascript', '.css': 'text/css', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
    res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store'); fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const role of ['operator', 'viewer', 'admin']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      await context.route('**/*', route => route.request().url().startsWith(origin + '/') ? route.continue() : route.abort());
      await context.addInitScript(({ login, server }) => {
        localStorage.setItem('sc.client.token', login.token);
        localStorage.setItem('sc.client.token.expiresAt', login.expiresAt);
        localStorage.setItem('sc.client.authServer', server);
      }, { login: accounts[role], server: origin + '/api' });
      const page = await context.newPage();
      await page.goto(origin + '/media');
      await page.getByText(sharedName, { exact: true }).first().waitFor();
      if (role !== 'viewer') {
        await page.getByText(privateName, { exact: true }).first().waitFor();
        assert.equal(await page.getByText('上传文件', { exact: true }).count(), 1);
      } else {
        assert.equal(await page.getByText(privateName, { exact: true }).count(), 0);
        assert.equal(await page.getByText('上传文件', { exact: true }).count(), 0);
        assert.equal(await page.locator('button[title="删除"]').count(), 0);
        assert.equal(await page.locator('button[title="推送到"]').count(), 0);
      }
      if (role === 'admin') await page.getByText('管理员内容管理', { exact: true }).waitFor();
      else assert.equal(await page.getByText('管理员内容管理', { exact: true }).count(), 0);
      console.log(`PASS built application: ${role} media visibility and controls at 390px`);
      await context.close();
    }
  } finally { if (browser) await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
